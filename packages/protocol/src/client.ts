/**
 * PelletPilot — local RPC client for a pellet grill's WiFi module (Mongoose OS).
 *
 * Talks to http://<host>/rpc/<Method>. Works in the browser and Node 18+ (global fetch).
 * HTTP is request/response only — poll getState(). For push updates use the BLE or cloud
 * transports (see docs/08). No auth is required unless a device password is set.
 */
import { CMD, setTemperature } from "./commands.js";
import { decodeStatus, decodeTemps, type GrillState } from "./frames.js";

export interface GrillOptions {
  /** device password (plaintext). If set, callers must supply the rolling `psw` — see docs/06. */
  password?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class PelletGrill {
  readonly base: string;
  private readonly timeoutMs: number;
  private readonly f: typeof fetch;
  private readonly password?: string;

  constructor(host: string, opts: GrillOptions = {}) {
    // accept "1.2.3.4", "grill.local", or a full URL
    this.base = /^https?:\/\//.test(host) ? host.replace(/\/$/, "") : `http://${host}`;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.f = opts.fetchImpl ?? fetch;
    this.password = opts.password;
  }

  /** Raw RPC call. Returns parsed JSON (or null for empty responses). */
  async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.f(`${this.base}/rpc/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });
      const text = await res.text();
      return text ? (JSON.parse(text) as T) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Send a raw FE..FF command frame to the control board. */
  async sendMCU(hexCommand: string): Promise<void> {
    const params: Record<string, unknown> = { command: hexCommand };
    if (this.password !== undefined) params.psw = this.password; // real auth: rolling codec, docs/06
    await this.rpc("PB.SendMCUCommand", params);
  }

  /** Latest decoded state (merges sc_11 status + sc_12 temps). */
  async getState(): Promise<GrillState> {
    const raw = (await this.rpc<{ sc_11?: string; sc_12?: string }>("PB.GetState")) ?? {};
    const out: GrillState = { raw: { sc11: raw.sc_11, sc12: raw.sc_12 } };
    if (raw.sc_11) Object.assign(out, decodeStatus(raw.sc_11) ?? {});
    if (raw.sc_12) Object.assign(out, decodeTemps(raw.sc_12) ?? {});
    return out;
  }

  async info() {
    return this.rpc("Sys.GetInfo");
  }

  // --- setpoint-level commands (the only writes the board accepts) ---
  setTemperature(tempF: number) {
    return this.sendMCU(setTemperature(tempF));
  }
  // No turnOn(): the protocol has no remote power-on (must be started physically).
  turnOff() {
    return this.sendMCU(CMD.TURN_OFF);
  }
  lightOn() {
    return this.sendMCU(CMD.LIGHT_ON);
  }
  lightOff() {
    return this.sendMCU(CMD.LIGHT_OFF);
  }
  primeOn() {
    return this.sendMCU(CMD.PRIME_MOTOR_ON);
  }
  primeOff() {
    return this.sendMCU(CMD.PRIME_MOTOR_OFF);
  }
  setFahrenheit() {
    return this.sendMCU(CMD.SET_FAHRENHEIT);
  }
  setCelsius() {
    return this.sendMCU(CMD.SET_CELSIUS);
  }
}
