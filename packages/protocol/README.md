# @pelletpilot/protocol

The shared heart of PelletPilot: a dependency-free TypeScript codec for the pellet-grill
`FE…FF` serial protocol, plus a local RPC client. Used by the server, the app, and anything
else that speaks to a grill.

Validated **app-accurate** against a live PBV control board (see
[`../../docs/03-mcu-serial-protocol.md`](../../docs/03-mcu-serial-protocol.md)).

## Install

```bash
pnpm add @pelletpilot/protocol
```

## Decode frames

```ts
import { decodeTemps, decodeStatus, probeConnected } from "@pelletpilot/protocol";

const t = decodeTemps("FE0C02020509060009060001070200000002020302020502020301FF");
// { grillSetTemp: 225, grillTemp: 223, p1Temp: 960, p3Temp: 172, isFahrenheit: true, ... }

if (probeConnected(t?.p3Temp)) console.log("meat probe:", t!.p3Temp, "°F");
```

## Talk to a grill on your LAN

```ts
import { PelletGrill } from "@pelletpilot/protocol";

const grill = new PelletGrill("192.168.4.1");       // ip / host / URL
const state = await grill.getState();               // merged, decoded
await grill.setTemperature(250);                    // FE0501020500FF
await grill.turnOff();
```

Works in the browser and Node 18+ (uses global `fetch`). HTTP is request/response only, so
poll `getState()`; for push updates use BLE or the cloud transport (roadmap).

## Command surface

The stock control board accepts only **setpoint-level** commands — there is **no** direct
auger / fan / igniter control (those run on the board from the setpoint). Available:
`setTemperature`, `turnOn/Off`, `lightOn/Off`, `primeOn/Off`, `setFahrenheit/Celsius`.
Status frames expose actuator *state* (`fanState`, `hotState`, `motorState`) as read-only
telemetry. See [`../../docs/07-pid-control-feasibility.md`](../../docs/07-pid-control-feasibility.md).

## Test

```bash
pnpm test    # decodes real captured frames, checks command encoding
```
