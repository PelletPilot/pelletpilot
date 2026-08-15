/**
 * Polls each registered device on the LAN via @pelletpilot/protocol, keeps the
 * latest live state in memory, and records cook history:
 *   - auto-starts a cook when the grill powers on
 *   - appends a sample each interval while running
 *   - records notable events (flameout, high temp)
 *   - auto-ends the cook after the grill has been off for a grace period
 */
import {
  PelletGrill, PROBE_DISCONNECTED, type GrillState,
} from "@pelletpilot/protocol";
import type { Store, Device } from "./db.js";

export interface Live {
  state: GrillState;
  at: number;
  online: boolean;
  cookId: number | null;
}

const OFF_GRACE_MS = 5 * 60 * 1000;

export class Poller {
  private grills = new Map<string, PelletGrill>();
  private latest = new Map<string, Live>();
  private offSince = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private store: Store, private intervalMs = 10_000) {
    this.reload();
  }

  /** Rebuild grill clients from the device registry (call after add/edit/remove). */
  reload() {
    const ids = new Set<string>();
    for (const d of this.store.listDevices()) {
      ids.add(d.id);
      this.grills.set(d.id, new PelletGrill(d.host));
    }
    for (const id of [...this.grills.keys()]) if (!ids.has(id)) this.grills.delete(id);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollAll(), this.intervalMs);
    void this.pollAll();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getLatest(id: string): Live | undefined {
    return this.latest.get(id);
  }

  private async pollAll() {
    const devices = this.store.listDevices();
    await Promise.all(devices.map((d) => this.pollOne(d).catch(() => this.markOffline(d))));
  }

  private markOffline(d: Device) {
    const prev = this.latest.get(d.id);
    this.latest.set(d.id, { state: prev?.state ?? {}, at: Date.now(), online: false, cookId: prev?.cookId ?? null });
    this.maybeEndCook(d.id, false);
  }

  private async pollOne(d: Device) {
    const grill = this.grills.get(d.id);
    if (!grill) return;
    const state = await grill.getState();
    const on = state.moduleIsOn === true;
    let cook = this.store.activeCook(d.id);

    if (on) {
      this.offSince.delete(d.id);
      if (!cook) cook = this.store.startCook(d.id);
      this.store.addSample({
        cookId: cook.id,
        ts: Date.now(),
        setTemp: numOr(state.grillSetTemp),
        grillTemp: numOr(state.grillTemp),
        probes: probeArray(state, d.capabilities.meatProbes),
        fan: !!state.fanState,
        auger: !!state.motorState,
        igniter: !!state.hotState,
        flags: flagsOf(state),
      });
      recordEvents(this.store, cook.id, state);
    } else {
      this.maybeEndCook(d.id, true);
    }

    this.latest.set(d.id, { state, at: Date.now(), online: true, cookId: this.store.activeCook(d.id)?.id ?? null });
  }

  private maybeEndCook(deviceId: string, poweredResponse: boolean) {
    const cook = this.store.activeCook(deviceId);
    if (!cook) return;
    const since = this.offSince.get(deviceId) ?? Date.now();
    if (!this.offSince.has(deviceId)) this.offSince.set(deviceId, since);
    if (Date.now() - since >= OFF_GRACE_MS) {
      this.store.endCook(cook.id);
      this.offSince.delete(deviceId);
    }
  }
}

function numOr(v: number | undefined): number | null {
  return typeof v === "number" ? v : null;
}
function probeArray(s: GrillState, n: number): (number | null)[] {
  const raw = [s.p1Temp, s.p2Temp, s.p3Temp, s.p4Temp];
  return raw.slice(0, n).map((v) => (v == null || v === PROBE_DISCONNECTED ? null : v));
}
function flagsOf(s: GrillState): string[] {
  const f: string[] = [];
  if (s.noPellets) f.push("noPellets");
  if (s.highTempErr) f.push("highTempErr");
  if (s.fanErr) f.push("fanErr");
  if (s.motorErr) f.push("motorErr");
  if (s.hotErr) f.push("hotErr");
  return f;
}

// fire an event once per rising edge of a fault flag
const lastFlags = new Map<string, Set<string>>();
function recordEvents(store: Store, cookId: number, s: GrillState) {
  const key = String(cookId);
  const prev = lastFlags.get(key) ?? new Set<string>();
  const now = new Set(flagsOf(s));
  for (const flag of now) if (!prev.has(flag)) store.addEvent(cookId, flag);
  lastFlags.set(key, now);
}
