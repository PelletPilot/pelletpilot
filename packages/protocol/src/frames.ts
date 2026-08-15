/**
 * PelletPilot — control-board frame decoding (PBV family).
 *
 * Frames are `FE <type> <payload…> FF`. Byte index 0 == 0xFE (matches firmware,
 * where powerStatusPos == 24). Temperatures are 3 decimal digits, one per byte:
 *   value = b[i]*100 + b[i+1]*10 + b[i+2]
 * 960 is the "probe disconnected" sentinel.
 *
 * Validated app-accurate against a live PBV grill; see docs/03-mcu-serial-protocol.md.
 */

export const PROBE_DISCONNECTED = 960;

export const FRAME_TYPE = {
  STATUS: 0x0b, // sc_11
  TEMPS: 0x0c, // sc_12
} as const;

export function hexToBytes(hex: string): number[] {
  const clean = hex.trim();
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

export function bytesToHex(bytes: number[] | Uint8Array): string {
  let s = "";
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, "0").toUpperCase();
  return s;
}

/** 3-digit decimal temperature starting at byte `i`. Returns undefined if out of range. */
function temp3(parts: number[], i: number): number | undefined {
  const h = parts[i];
  const t = parts[i + 1];
  const o = parts[i + 2];
  if (h === undefined || t === undefined || o === undefined) return undefined;
  return h * 100 + t * 10 + o;
}

export interface Temps {
  p1Temp?: number;
  p2Temp?: number;
  p3Temp?: number;
  p4Temp?: number;
  smokerActTemp?: number;
  grillSetTemp?: number;
  grillTemp?: number;
  isFahrenheit: boolean;
}

export interface Status {
  moduleIsOn: boolean;
  err1: boolean;
  err2: boolean;
  err3: boolean;
  highTempErr: boolean;
  fanErr: boolean;
  hotErr: boolean;
  motorErr: boolean;
  noPellets: boolean;
  erL: boolean;
  /** actuator STATE telemetry (read-only; cannot be commanded directly) */
  fanState: boolean; // combustion fan
  hotState: boolean; // igniter hot-rod
  motorState: boolean; // auger motor
  lightState: boolean;
  primeState: boolean;
  recipeStep: number;
  recipeTimeS: number;
}

export type GrillState = Partial<Temps> & Partial<Status> & { raw?: { sc11?: string; sc12?: string } };

/** Decode a `FE0C…FF` temperatures frame (`sc_12`). */
export function decodeTemps(sc12Hex: string): Temps | null {
  const p = hexToBytes(sc12Hex);
  if (p.length < 27 || p[1] !== FRAME_TYPE.TEMPS) return null;
  return {
    p1Temp: temp3(p, 5),
    p2Temp: temp3(p, 8),
    p3Temp: temp3(p, 11),
    p4Temp: temp3(p, 14),
    smokerActTemp: temp3(p, 17),
    grillSetTemp: temp3(p, 20),
    grillTemp: temp3(p, 23),
    isFahrenheit: p[26] === 1,
  };
}

/** Decode a `FE0B…FF` status frame (`sc_11`). */
export function decodeStatus(sc11Hex: string): Status | null {
  const p = hexToBytes(sc11Hex);
  if (p.length < 44 || p[1] !== FRAME_TYPE.STATUS) return null;
  const at = (i: number) => p[i] === 1;
  return {
    moduleIsOn: at(24),
    err1: at(25),
    err2: at(26),
    err3: at(27),
    highTempErr: at(28),
    fanErr: at(29),
    hotErr: at(30),
    motorErr: at(31),
    noPellets: at(32),
    erL: at(33),
    fanState: at(34),
    hotState: at(35),
    motorState: at(36),
    lightState: at(37),
    primeState: at(38),
    recipeStep: p[40] ?? 0,
    recipeTimeS: (p[41] ?? 0) * 3600 + (p[42] ?? 0) * 60 + (p[43] ?? 0),
  };
}

/** Is a decoded probe value a real reading (vs. the disconnected sentinel)? */
export function probeConnected(v: number | undefined): v is number {
  return v !== undefined && v !== PROBE_DISCONNECTED;
}
