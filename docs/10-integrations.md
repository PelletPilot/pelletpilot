# 10 — Integrations & Smart-Home Strategy

PelletPilot's opportunity is to be the **one dashboard** across grills, smokers, and wireless
thermometers — most vendor apps are single-brand — and to be a **first-class Home Assistant
citizen**. This doc captures the integration landscape, feasibility, and the architecture to
support it.

> Research current as of 2026-08. Third-party protocols change; re-verify before building.

## The `Source` / connector model

Generalize "device" into normalized **Sources** that all map to the same state shape
(`grillTemp`, `grillSetTemp`, `probes[]`, actuator/fault flags), so the app UI and cook-history
recording work unchanged across brands.

- **PitBossSource** — LAN HTTP poll (implemented today).
- **Cloud connectors** (server-side, ideal in the Bridge): user links a vendor account/token;
  the server pulls + normalizes. e.g. MEATER, FireBoard, Traeger, ThermoMaven.
- **BLE sources** (mobile app radio): Combustion, MEATER, Inkbird, ThermoPro.

Two directions:
1. **Consume** — pull other devices into PelletPilot.
2. **Expose** — publish PelletPilot devices to Home Assistant (see MQTT section) — the biggest
   low-effort adoption lever for the pitmaster crowd.

## Device integration priority

Ranked by popularity × openness × complement value. "Openness" ★★★ = official open
spec/SDK, ★★ = official API, ★ = reverse-engineered (fragile).

| # | Device | Type | Connectivity | Openness | Approach |
|---|--------|------|-------------|----------|----------|
| 1 | **Combustion Inc** (Predictive) | wireless probe | BLE | ★★★ official open BLE spec + iOS/Android/Python SDKs (MIT) | app BLE / Bridge BLE |
| 2 | **MEATER / MEATER 2** | wireless probe | BLE + cloud | ★★ official public Cloud REST API (JWT) + BLE | cloud connector and/or app BLE |
| 3 | **FireBoard** (+ Drive) | probe hub + **PID fan control** | WiFi/cloud | ★★ documented Cloud API (token, 17 req/5min) | cloud connector; Drive adds closed-loop control |
| 4 | **Traeger WiFire** | pellet grill | WiFi/cloud | ★ reverse-engineered (`hass_traeger`) | cloud connector |
| 5 | **Green Mountain Grills** | pellet grill | **local REST/UDP** | ★★ open local API (`/api/status`, `/api/poweron`) | LAN connector; supports remote power-on |
| 6 | **ThermoMaven** (Auros) | wireless probe (multi-zone) | base→WiFi→cloud (AWS IoT MQTT) | ★ fully reverse-engineered but obfuscated/brittle | cloud connector (best-effort tier) |
| 7 | **Inkbird** (IBBQ/IBT) | budget probes | BLE + WiFi | ~ community BLE libs | app BLE |
| 8 | ThermoWorks (Signals/RFX), Recteq, Weber, Chef iQ, ThermoPro, Anova | mixed | mixed | mixed | later |

### Notes
- **Combustion** is the best first thermometer: MIT SDKs + public probe BLE spec → stable and
  low-effort. Highest fidelity.
- **MEATER** is the most popular probe and has an official (beta) cloud API; also an official
  Home Assistant core integration to match/interop with.
- **FireBoard Drive** is a sleeper: probe hub *and* a PID fan controller — could give real
  closed-loop chamber control on grills that don't expose it (ties to docs/07 PID goals).
- **GMG** has an open local API and (unlike Pit Boss) a remote power-on — good non-Pit-Boss
  grill to prove the multi-brand model.
- **ThermoMaven**: popular on Amazon, but integration depends on reversed, obfuscated cloud
  auth (JNI key recovery) → fragile; ship as community/best-effort tier, not "officially
  supported." Reference the reversed protocol writeup rather than re-doing it.

## Home Assistant landscape (reference / competitive set)

| Device | HA integration | Transport |
|--------|---------------|-----------|
| MEATER | **official core** integration (3,300+ installs) + local BLE forks | cloud + BLE |
| Combustion | mature HACS (`legrego`, `whilke`) | local BLE + MeatNet |
| **Pit Boss** | `ha-pitboss` (dknowles2, on pytboss) | local BLE, no cloud |
| Traeger | `hass_traeger` | cloud (reverse-eng) |
| Green Mountain Grills | HACS + UDP auto-discovery | open local REST |
| Recteq | LocalTuya / custom (flaky) | Tuya |
| ThermoMaven | `kingchddg901/ha-thermomaven`, `djiesr/ThermoMaven-ha` | reversed cloud MQTT |
| Anova | HACS oven | cloud |

The space is **fragmented, per-brand, uneven quality** — no unifying hub. That's PelletPilot's
opening.

## Expose to Home Assistant via MQTT Discovery (recommended, early)

The server/Bridge publishes each grill+probe as an auto-discovered MQTT device — zero config
for HA users, and since PelletPilot already normalizes multi-brand devices, one Bridge
re-exposes *all* of them to HA.

Entity model (mirror `ha-pitboss` so it feels native):
- `climate.<grill>` — target + current temp, hvac_mode heat/off; setpoint writable.
- `sensor.<grill>_probe_N` — one per meat probe (per capabilities).
- `binary_sensor.<grill>_*` — flameout / high-temp / no-pellets; actuator running states
  (fan / auger / igniter) as read-only.
- Available even when the grill is off.

Implementation: retained MQTT discovery config topics under `homeassistant/`, state topics
updated from the poller's normalized state. Small addition — the normalized state already
exists. Great fit for the always-on Bridge.

## Sources
- Combustion: https://github.com/combustion-inc · https://github.com/legrego/combustion_ble
- MEATER API: https://github.com/apption-labs/meater-cloud-public-rest-api · HA: https://www.home-assistant.io/integrations/meater/
- FireBoard API: https://docs.fireboard.io/app/api.html
- Traeger: https://github.com/sebirdman/hass_traeger
- Green Mountain Grills: https://github.com/jwhitby91/gmg_home_assistant
- Pit Boss: https://github.com/dknowles2/ha-pitboss · https://github.com/dknowles2/pytboss
- ThermoMaven: https://github.com/kingchddg901/ha-thermomaven · https://github.com/djiesr/thermomaven-ha
- Combustion HA: https://github.com/legrego/homeassistant-combustion
- HA MQTT discovery: https://www.home-assistant.io/integrations/mqtt/
