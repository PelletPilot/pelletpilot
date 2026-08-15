import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTemps, decodeStatus, PROBE_DISCONNECTED } from "../src/frames.ts";
import { setTemperature, CMD } from "../src/commands.ts";

// Real captured frames from a live PBV grill (validated app-accurate, docs/03).
const SC12 = "FE0C02020509060009060001070200000002020302020502020301FF";
const SC11 = "FE0B020205090600090600010702000000020209020209010100000000000000000001000000000100000000FF";

test("decodeTemps: set/actual/probe + units", () => {
  const t = decodeTemps(SC12);
  assert.ok(t);
  assert.equal(t!.grillSetTemp, 225);
  assert.equal(t!.grillTemp, 223);
  assert.equal(t!.p1Temp, PROBE_DISCONNECTED); // unplugged
  assert.equal(t!.p2Temp, PROBE_DISCONNECTED);
  assert.equal(t!.p3Temp, 172); // brisket probe
  assert.equal(t!.isFahrenheit, true);
});

test("decodeStatus: power + actuator telemetry", () => {
  const s = decodeStatus(SC11);
  assert.ok(s);
  assert.equal(s!.moduleIsOn, true);
  assert.equal(s!.fanState, true); // fan running in this capture
  assert.equal(s!.highTempErr, false);
  assert.equal(s!.noPellets, false);
});

test("decodeTemps rejects a status frame", () => {
  assert.equal(decodeTemps(SC11), null);
});

test("setTemperature encoding + 5° quantization", () => {
  assert.equal(setTemperature(225), "FE0501020205FF");
  assert.equal(setTemperature(250), "FE0501020500FF");
  assert.equal(setTemperature(203), "FE0501020205FF"); // 203 -> 205
  assert.equal(CMD.TURN_OFF, "FE0102FF");
});
