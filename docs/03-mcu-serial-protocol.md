# 03 — Control-Board Serial Protocol (`FE … FF`)

This is the protocol between the ESP32 and the control-board MCU over UART
(115200 8N1, ESP32 GPIO16=RX / GPIO17=TX). You reach it remotely through
`PB.SendMCUCommand` (write) and `PB.GetState` (read). Cross-checked against the
`pytboss` **PBV** control-board spec in [`../reference/grills.json`](../reference/grills.json)
and validated against live frames from this device.

## Frame format

```
FE  <type>  <payload …>  FF
```

- `0xFE` = start delimiter, `0xFF` = end delimiter.
- Byte indexing below **includes** the leading `0xFE` at index 0 (matches the firmware:
  `powerStatusPos == 24`).
- Multi-digit values are **decimal-digit-per-byte**. A temperature at offset `i` is:
  `value = b[i]*100 + b[i+1]*10 + b[i+2]`.
- `960` is the **"probe disconnected"** sentinel.

## Commands (ESP32 → control board)

| Slug | Bytes | Notes |
|------|-------|-------|
| get-status | `FE 0B 01 FF` | Ask for a status frame (type 0x0B). ESP32 polls this. |
| get-temperatures | `FE 0C 01 FF` | Ask for a temperature frame (type 0x0C). |
| set-temperature | `FE 05 01 <H> <T> <O> FF` | Set grill target. Digits hundreds/tens/ones, one per byte. Rounded to nearest 5°F. e.g. **225°F → `FE0501020205FF`**, 250 → `FE0501020500FF`. |
| set-fahrenheit | `FE 09 01 FF` | Units = °F. |
| set-celsius | `FE 09 02 FF` | Units = °C. |
| turn-off | `FE 01 02 FF` | Power off the grill. **No remote power-ON command exists** — igniting must be done physically at the grill (all boards expose only turn-off). |
| turn-light-on | `FE 02 01 FF` | Cabinet light on. |
| turn-light-off | `FE 02 00 FF` | Cabinet light off. |
| turn-primer-motor-on | `FE 08 01 FF` | **Primer** motor (initial pellet prime) on. |
| turn-primer-motor-off | `FE 08 00 FF` | Primer motor off. |
| set-probe-1-temperature | `FE 05 …` (fn) | Set meat-probe-1 *alarm target*. |
| set-probe-2-temperature | `FE 05 …` (fn) | Set meat-probe-2 *alarm target*. |

Also seen from the firmware (not in the pytboss command table):

| Bytes | Meaning |
|-------|---------|
| `FE 24 01 FF` | ESP32 → board: "WiFi connected" (sent on `STATUS_GOT_IP`). |
| `FE 24 00 FF` | ESP32 → board: "WiFi disconnected". |

> **There is no command to directly drive the auger, combustion fan, or igniter.**
> The only actuators you can toggle are the **light** and the **primer** motor. Everything
> else is decided by the control board's own algorithm from the target temperature.
> This is the central constraint behind the PID question (doc 07).

## Status frame — type `0x0B` (`sc_11`)

Decoder: `decode_status()` in `tools/pbclient.py`. Field offsets (byte index, incl. FE):

| Offset | Field | Meaning |
|-------:|-------|---------|
| 24 | `module_is_on` | grill powered on (`==1`) |
| 25 | `err_1` | error flag 1 |
| 26 | `err_2` | error flag 2 |
| 27 | `err_3` | error flag 3 |
| 28 | `high_temp_err` | over-temperature |
| 29 | `fan_err` | combustion fan fault |
| 30 | `hot_err` | igniter/temperature fault |
| 31 | `motor_err` | auger motor fault |
| 32 | `no_pellets` | out-of-pellets / flameout |
| 33 | `er_l` | "ErL" low-temp error |
| **34** | `fan_state` | **combustion fan running** (read-only) |
| **35** | `hot_state` | **igniter hot-rod energized** (read-only) |
| **36** | `motor_state` | **auger motor running** (read-only) |
| 37 | `light_state` | cabinet light on |
| 38 | `prime_state` | priming |
| 40 | `recipe_step` | active recipe step |
| 41–43 | `recipe_time_s` | `b41*3600 + b42*60 + b43` |

Offsets 34–36 are exactly the actuator telemetry that lets you **observe** the stock
control loop (fan/igniter/auger duty) even though you can't command them.

## Temperature frame — type `0x0C` (`sc_12`)

Decoder: `decode_temps()`. Offsets:

| Offset | Field | Meaning |
|-------:|-------|---------|
| 5  | `p1_temp` | meat probe 1 (`960` = unplugged) |
| 8  | `p2_temp` | meat probe 2 |
| 11 | `p3_temp` | meat probe 3 |
| 14 | `p4_temp` | meat probe 4 |
| 17 | `smoker_act_temp` | chamber actual (alt reading) |
| 20 | `grill_set_temp` | target temperature |
| 23 | `grill_temp` | chamber actual temperature |
| 26 | `is_fahrenheit` | units (`==1` → °F) |

### Worked example (real capture from this device)

```
sc_12 = FE0C 02 02 05 09 06 00 09 06 00 01 07 02 00 00 00 02 02 03 02 02 05 02 02 03 01 FF
index    0    2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26

p1_temp  @5  = 9,6,0 = 960  (unplugged)
p2_temp  @8  = 9,6,0 = 960  (unplugged)
p3_temp  @11 = 1,7,2 = 172  (brisket — validated against physical probe)
p4_temp  @14 = 0,0,0 = 0
smoker   @17 = 2,2,3 = 223
set_temp @20 = 2,2,5 = 225
grill    @23 = 2,2,3 = 223
isF      @26 = 1      = °F
```

Run it yourself:

```bash
python3 tools/decode_state.py FE0C02020509060009060001070200000002020302020502020301FF
```

### Ground-truth validation against the official app

During capture, the physical **probe 3** (in a brisket) read `170/172` flapping in the
**official Pit Boss phone app**, and `decode_temps()` produced the *same* `170/172` flap
from `p3_temp` (offset 11) at the same time. The chamber set/actual (`225` / `223–224`)
also matched the app. This confirms the decode is **app-accurate** — a replacement app
built on `tools/pbclient.py` displays exactly what the stock app displays, with no cloud.
(Note: a just-wrapped/re-seated meat probe reads low and flaps while it re-equilibrates —
that's the probe, not a decode error.)

## Notes / caveats

- `p3_temp @11` reading `172` on this unit is a live meat probe (brisket). On some
  boards/firmware the p3/p4 slots differ; trust the physical validation above for *this*
  device.
- `smoker_act_temp` and `grill_temp` usually agree; both are chamber-side readings.
- The pytboss `status_function` for PBV comments out the probe fields inside the 0x0B
  frame and reads them from the 0x0C frame instead — which is why the client merges both.
- The control board also emits other `FE..FF` message types during boot/priming; the
  ESP32 (`psUartMessage` in `platform.js`) is a no-op stub here, so they're just relayed.
