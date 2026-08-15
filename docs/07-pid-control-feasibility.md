# 07 — Can You Rebuild the Temp Loop into PID?

**Short answer:** Not through the WiFi board. The stock **hi/low on-off (hysteresis)**
algorithm and the actuators it drives live on the **control-board MCU**, which you can't
reflash over WiFi and which exposes only *setpoint-level* commands. To get real PID you
either run a coarse **supervisory** loop on top of the stock controller (software only,
limited), or you **replace the control board** with your own MCU + drivers (full control).

This doc lays out exactly why, and both paths.

---

## Why not over the network

From doc 01/03, the division of labor is hard:

| Function | Lives on | Reachable remotely? |
|----------|----------|---------------------|
| Read chamber RTD + meat probes | control board ADC | only as **decoded temps** (read-only) |
| Igniter hot-rod drive | control board | **no direct command** — only `hot_state` telemetry |
| Auger (pellet feed) drive | control board | **no direct command** — only `motor_state` telemetry |
| Combustion fan drive | control board | **no direct command** — only `fan_state` telemetry |
| The control algorithm (hysteresis) | control board firmware | **not reflashable over WiFi** |
| LCD content | control board | no command to write arbitrary content |
| Target temperature | control board setpoint | ✅ `set-temperature` (5°F steps) |
| Light / primer / power / units | control board | ✅ on/off commands |

The complete command set is 9 verbs (doc 03). None of them touch auger/fan/igniter duty.
The status frame *reports* `fan_state`/`hot_state`/`motor_state` so you can **watch** the
stock loop actuate — but there is no write path to those actuators. That's the wall.

So any "PID" you implement purely in software is necessarily an **outer loop** that can
only turn one knob the inner controller respects: **the setpoint**.

---

## Path A — Supervisory ("setpoint-tricking") PID — *software only, no hardware mod*

Run a PID controller off-device (or inside a modified `init.js`) whose **process variable**
is `grill_temp` and whose **output** is a *commanded setpoint* sent via `set-temperature`.

```
        your PID (error = desired_pit_temp - grill_temp)
                     │  output u
                     ▼
        commanded_setpoint = clamp( desired + K·u , 180..500, step 5 )
                     │  FE0501.. FF every N seconds
                     ▼
        stock control board runs ITS hysteresis toward commanded_setpoint
                     │  drives auger/fan/igniter
                     ▼
                  chamber temp  ──────────────► back to PID
```

**What it buys you:** you can bias the stock controller — e.g. push the setpoint up
during a lid-open recovery, or ride it down to kill an overshoot — and you can add
features the stock firmware lacks (probe-target auto-shutdown, ramp/soak profiles,
"turbo" recovery, notifications).

**Hard limits (be honest with yourself):**
- **Coarse actuator, coarse resolution.** Your only lever is a setpoint quantized to 5°F.
  You cannot modulate auger seconds-on or fan PWM. The board still runs *its* on-off loop;
  you're just moving its target.
- **Cascaded loops fight.** You'd be a slow outer loop around an unknown inner controller
  with its own hysteresis band and lag — easy to induce oscillation. Keep your loop slow
  (30–60 s), gains gentle, mostly P + a little I, and rate-limit setpoint changes.
- **No new control authority.** If the stock loop overshoots by design (pellet dumps,
  fan cycling), setpoint-tricking only partially masks it.

Verdict: worth doing for **smoother holds + smarter features**, not for a true tight PID.
A starter implementation is sketched in doc 08 (`pid_supervisor.py`).

---

## Path B — Replace the control board — *full PID, the real answer*

This is what DIY pellet-PID builds do, and it's the only way to truly own igniter/auger/
fan/probes/LCD. You keep all the **hardware** (hopper, auger motor, firepot, igniter rod,
blower, RTD) and replace only the **brain**.

### Bill of materials (typical)
| Function | Part |
|----------|------|
| Controller | ESP32 / RP2040 / Raspberry Pi (Pi gives you easy logging + web UI) |
| Chamber temp | **PT100/PT1000 RTD → MAX31865** (the stock chamber sensor is an RTD) |
| Meat probes | 100k NTC thermistor → ADC + divider, **or** thermocouple → MAX31855/31856 |
| Igniter (hot rod, mains, ~200 W resistive) | **SSR** (solid-state relay), zero-cross |
| Auger motor (AC gearmotor) | relay or SSR; PID drives **duty cycle** (e.g. Xs on / Ys cycle) |
| Combustion fan | DC blower → **MOSFET PWM**, or AC fan → relay |
| Display | your own I²C/SPI LCD/OLED |
| Power | reuse the grill's transformer/PSU or add one |

### Control design
- **Inner:** chamber-temp PID → **auger feed rate** (pellets = fuel = heat). Fan often
  fixed/high during burn, modulated for smoke vs. heat. Igniter is a startup state, not a
  PID output (energize until firepot lights, then off; relight on flameout detection).
- **Outer (optional):** meat-probe target → done/hold logic.
- **Safety (must-have):** high-temp cutoff, flameout/no-rise detection (auger off if temp
  doesn't climb after ignition), auger jam handling, watchdog. You are now responsible for
  a 200 W igniter and a fire — build the interlocks first.

### Keep the app working (nice trick)
Keep the ESP32 WiFi module, and have **your** controller **emulate the Dansons serial
protocol** — respond to `FE0B01FF`/`FE0C01FF` with correctly formatted `sc_11`/`sc_12`
frames (doc 03) and accept `FE0501..FF` setpoints. Then the stock ESP32, the phone app,
and the cloud keep working unchanged while your firmware runs the real PID underneath.
(You already have the exact frame encoder/decoder in `tools/`.)

### Risk / effort
- Mains wiring + a live fire: real hazard. Do the electrical safely (fused, grounded,
  SSRs rated with margin, enclosure). This is the serious part, not the code.
- Reversible-ish: keep the stock board to swap back.
- Effort: a weekend for a bench PID proof, longer to make it safe and pretty.

---

## Path C — Reflash the control-board MCU in place — *not recommended*

If the control board's MCU were reflashable (JTAG/SWD/UART bootloader, unlocked) you could
put PID firmware directly on it and keep all the existing drivers. In practice these boards
usually run a locked/mask-ROM MCU with no exposed debug and no source — so this is rarely
practical and gets you little that Path B doesn't. Skip unless you identify a known-flashable
MCU on the board and enjoy the yak-shave.

---

## Recommendation

- Want **smarter holds + features fast, no soldering** → **Path A** (supervisory), accept
  it's a soft improvement over hysteresis.
- Want **actual PID control of the fire** (auger/fan/igniter, custom LCD) → **Path B**,
  replace the controller, emulate the serial protocol so the app still works.
- The ESP32/cloud layer is orthogonal to all of this — you can keep or replace it either way.
