/**
 * SQLite storage for the self-host server. No auth (LAN-trusted).
 * Tables: devices, cooks (sessions), samples (time series), events.
 */
import Database from "better-sqlite3";
import type { Capabilities } from "@pelletpilot/protocol";

export interface DeviceRow {
  id: string; // device id (from firmware) or a user slug
  name: string;
  host: string; // ip / hostname on the LAN
  model: string | null;
  control_board: string | null;
  capabilities: string; // JSON Capabilities
  created_at: number;
}

export interface Device {
  id: string;
  name: string;
  host: string;
  model: string | null;
  controlBoard: string | null;
  capabilities: Capabilities;
  createdAt: number;
}

export interface Cook {
  id: number;
  deviceId: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  notes: string | null;
}

export interface Sample {
  cookId: number;
  ts: number;
  setTemp: number | null;
  grillTemp: number | null;
  probes: (number | null)[]; // per meat probe; null = disconnected
  fan: boolean;
  auger: boolean;
  igniter: boolean;
  flags: string[]; // e.g. ["noPellets"]
}

export function openDb(file: string) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL,
      model TEXT, control_board TEXT, capabilities TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
      title TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, notes TEXT,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS samples (
      cook_id INTEGER NOT NULL, ts INTEGER NOT NULL,
      set_temp REAL, grill_temp REAL, probes TEXT NOT NULL,
      fan INTEGER, auger INTEGER, igniter INTEGER, flags TEXT NOT NULL,
      FOREIGN KEY(cook_id) REFERENCES cooks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_samples_cook_ts ON samples(cook_id, ts);
    CREATE TABLE IF NOT EXISTS events (
      cook_id INTEGER NOT NULL, ts INTEGER NOT NULL, type TEXT NOT NULL, note TEXT,
      FOREIGN KEY(cook_id) REFERENCES cooks(id) ON DELETE CASCADE
    );
  `);
  return new Store(db);
}

function toDevice(r: DeviceRow): Device {
  return {
    id: r.id, name: r.name, host: r.host, model: r.model,
    controlBoard: r.control_board, capabilities: JSON.parse(r.capabilities),
    createdAt: r.created_at,
  };
}

export class Store {
  constructor(private db: Database.Database) {}

  // --- devices ---
  listDevices(): Device[] {
    return (this.db.prepare("SELECT * FROM devices ORDER BY created_at").all() as DeviceRow[]).map(toDevice);
  }
  getDevice(id: string): Device | undefined {
    const r = this.db.prepare("SELECT * FROM devices WHERE id=?").get(id) as DeviceRow | undefined;
    return r ? toDevice(r) : undefined;
  }
  upsertDevice(d: Omit<Device, "createdAt"> & { createdAt?: number }): Device {
    const createdAt = d.createdAt ?? this.getDevice(d.id)?.createdAt ?? nowMs();
    this.db.prepare(
      `INSERT INTO devices (id,name,host,model,control_board,capabilities,created_at)
       VALUES (@id,@name,@host,@model,@control_board,@capabilities,@created_at)
       ON CONFLICT(id) DO UPDATE SET name=@name,host=@host,model=@model,
         control_board=@control_board,capabilities=@capabilities`
    ).run({
      id: d.id, name: d.name, host: d.host, model: d.model ?? null,
      control_board: d.controlBoard ?? null, capabilities: JSON.stringify(d.capabilities),
      created_at: createdAt,
    });
    return this.getDevice(d.id)!;
  }
  deleteDevice(id: string) {
    this.db.prepare("DELETE FROM devices WHERE id=?").run(id);
  }

  // --- cooks ---
  activeCook(deviceId: string): Cook | undefined {
    return this.mapCook(this.db.prepare(
      "SELECT * FROM cooks WHERE device_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).get(deviceId));
  }
  startCook(deviceId: string, title?: string): Cook {
    const info = this.db.prepare(
      "INSERT INTO cooks (device_id,title,started_at) VALUES (?,?,?)"
    ).run(deviceId, title ?? null, nowMs());
    return this.getCook(Number(info.lastInsertRowid))!;
  }
  endCook(cookId: number) {
    this.db.prepare("UPDATE cooks SET ended_at=? WHERE id=? AND ended_at IS NULL").run(nowMs(), cookId);
  }
  getCook(id: number): Cook | undefined {
    return this.mapCook(this.db.prepare("SELECT * FROM cooks WHERE id=?").get(id));
  }
  listCooks(deviceId: string, limit = 50): Cook[] {
    return (this.db.prepare(
      "SELECT * FROM cooks WHERE device_id=? ORDER BY started_at DESC LIMIT ?"
    ).all(deviceId, limit) as any[]).map((r) => this.mapCook(r)!);
  }
  private mapCook(r: any): Cook | undefined {
    return r ? { id: r.id, deviceId: r.device_id, title: r.title, startedAt: r.started_at, endedAt: r.ended_at, notes: r.notes } : undefined;
  }

  // --- samples & events ---
  addSample(s: Sample) {
    this.db.prepare(
      `INSERT INTO samples (cook_id,ts,set_temp,grill_temp,probes,fan,auger,igniter,flags)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(s.cookId, s.ts, s.setTemp, s.grillTemp, JSON.stringify(s.probes),
      s.fan ? 1 : 0, s.auger ? 1 : 0, s.igniter ? 1 : 0, JSON.stringify(s.flags));
  }
  getSamples(cookId: number): Sample[] {
    return (this.db.prepare("SELECT * FROM samples WHERE cook_id=? ORDER BY ts").all(cookId) as any[]).map((r) => ({
      cookId: r.cook_id, ts: r.ts, setTemp: r.set_temp, grillTemp: r.grill_temp,
      probes: JSON.parse(r.probes), fan: !!r.fan, auger: !!r.auger, igniter: !!r.igniter,
      flags: JSON.parse(r.flags),
    }));
  }
  addEvent(cookId: number, type: string, note?: string) {
    this.db.prepare("INSERT INTO events (cook_id,ts,type,note) VALUES (?,?,?,?)").run(cookId, nowMs(), type, note ?? null);
  }
  getEvents(cookId: number) {
    return this.db.prepare("SELECT ts,type,note FROM events WHERE cook_id=? ORDER BY ts").all(cookId);
  }
}

function nowMs() {
  return Date.now();
}
