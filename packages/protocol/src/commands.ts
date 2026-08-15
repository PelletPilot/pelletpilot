/**
 * PelletPilot — control-board command builders (PBV family).
 *
 * These are the ONLY writes the stock control board accepts. There is no direct
 * auger / fan / igniter command — the board runs those internally from the setpoint.
 * See docs/03-mcu-serial-protocol.md and docs/07-pid-control-feasibility.md.
 */

function hb(n: number): string {
  return (n & 0xff).toString(16).padStart(2, "0").toUpperCase();
}

/** Static command frames. */
export const CMD = {
  GET_STATUS: "FE0B01FF",
  GET_TEMPERATURES: "FE0C01FF",
  SET_FAHRENHEIT: "FE0901FF",
  SET_CELSIUS: "FE0902FF",
  TURN_ON: "FE0101FF",
  TURN_OFF: "FE0102FF",
  LIGHT_ON: "FE0201FF",
  LIGHT_OFF: "FE0200FF",
  PRIME_MOTOR_ON: "FE0801FF",
  PRIME_MOTOR_OFF: "FE0800FF",
} as const;

/**
 * Build a set-temperature frame. The board accepts °F in 5° steps.
 * `FE0501 <hundreds> <tens> <ones> FF`, one decimal digit per byte.
 * e.g. setTemperature(225) -> "FE0501020205FF"
 */
export function setTemperature(tempF: number): string {
  const t = Math.round(Math.max(0, Math.min(600, tempF)) / 5) * 5;
  const h = Math.floor(t / 100);
  const te = Math.floor((t % 100) / 10);
  const o = t % 10;
  return "FE0501" + hb(h) + hb(te) + hb(o) + "FF";
}

// NOTE: The PBV control board exposes no set-probe-target command (unlike some other
// Dansons boards, e.g. LBL). Meat-probe alarm targets are set app-side, not on the board.
// Don't invent one here — verify against reference/grills.json per control board before adding.
