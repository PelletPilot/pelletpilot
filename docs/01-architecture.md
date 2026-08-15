# 01 — System Architecture

The smoker is **three independent computers** wired together. Understanding this split
is the single most important thing for any modification you attempt.

```
                 ┌──────────────────────────────────────────────────────────────┐
                 │                         THE SMOKER                             │
                 │                                                                │
   pellets ─────▶│  ┌───────────────────┐   UART 115200    ┌──────────────────┐  │
   firepot       │  │  CONTROL BOARD MCU │◀────8N1─────────▶│  ESP32 WiFi/BT   │  │
   igniter ◀─────┤  │  (Dansons "PBV")   │  GPIO16=RX       │  MODULE          │  │
   auger  ◀──────┤  │                    │  GPIO17=TX       │  Mongoose OS     │  │
   fan    ◀──────┤  │  • RTD/probe ADCs  │                  │  app: PBVNEW     │  │
   RTD    ─────▶ │  │  • control algo    │  FE..FF frames   │  init.js (mJS)   │  │
   LCD    ◀──────┤  │    (hi/low on-off) │                  │                  │  │
   buttons ─────▶│  │  • actuator drivers│                  │  • HTTP :80 RPC  │  │
                 │  │  • LCD driver      │                  │  • BLE GATT RPC  │  │
                 │  └───────────────────┘                  │  • WS → cloud    │  │
                 │        ▲                                 └───────┬──────────┘  │
                 │        │ the ESP32 can ONLY send it                │           │
                 │        │ setpoint-level FE..FF commands            │           │
                 └────────┼───────────────────────────────────────────┼──────────┘
                          │                                            │ WiFi
                   (no direct actuator                          ┌──────▼─────────────┐
                    access from ESP32)                          │   Your LAN / router │
                                                                └──────┬─────────────┘
                                                                       │ Internet
                                       ┌───────────────────────────────▼───────────────┐
                                       │  DANSONS CLOUD                                 │
                                       │  api-prod.dansonscorp.com  (REST, Laravel/Azure)│
                                       │  socket.dansonscorp.com    (WebSocket, Fastly)  │
                                       └───────────────────────────────▲───────────────┘
                                                                        │
                                                                 ┌──────┴──────┐
                                                                 │  Phone app  │
                                                                 └─────────────┘
```

## The three computers

### 1. Control board MCU ("PBV") — *the brain*
A dedicated microcontroller (not the ESP32). It owns **all** of the electronics that
matter for temperature control:

- Reads the **chamber RTD** and the **meat probes** (analog → digital).
- Runs the **temperature control algorithm** — the stock **hysteresis / "hi-low on-off"**
  loop you want to replace.
- Drives the **igniter** (hot rod), **auger motor** (pellet feed), and **combustion fan**.
- Drives the **LCD** and reads the front-panel buttons.
- Speaks a simple **`FE … FF` serial protocol** over UART to the ESP32.

You do **not** have its source, and it is **not reflashable over WiFi**. Everything you
can do to it remotely goes through the narrow serial command set in
[`03-mcu-serial-protocol.md`](03-mcu-serial-protocol.md).

### 2. ESP32 WiFi/BT module — *the bridge*
Espressif ESP32 running **Mongoose OS**. Its entire job is connectivity. The application
is interpreted JavaScript (`init.js`, "PitBoss Firmware 0.5.7"). It:

- Polls the control board every ~2 s (`FE0B01FF` / `FE0C01FF`), buffers the latest
  status/temperature frames.
- Exposes those frames + a command passthrough as **RPC** over three channels:
  **HTTP** (`http://ip/rpc/<Method>`), **BLE GATT**, and a **WebSocket to the cloud**.
- Connects out to `https://socket.dansonscorp.com/from/<deviceId>` and forwards any RPC
  the cloud sends down to the local RPC layer (so the cloud drives the grill using the
  same methods you can call locally).

Critically: the ESP32 uses **only UART1 (GPIO16/17)** to reach the control board. It has
**no wiring to the igniter/auger/fan/probes/LCD**. It cannot bypass the control board.

### 3. Dansons cloud — *the relay*
- `api-prod.dansonscorp.com` — REST API, **Laravel/PHP on Azure App Service** (nginx,
  `dansons_api_session` + `XSRF-TOKEN` cookies). Accounts, device registration, history.
- `socket.dansonscorp.com` — realtime **WebSocket** relay fronted by **Fastly**. This is
  how the phone app and the grill talk when you're away from home.

See [`04-cloud-api.md`](04-cloud-api.md).

## Firmware/version facts (from `Sys.GetInfo`)

| field | value |
|-------|-------|
| app | `PBVNEW` |
| fw_version (mJS app) | `42.43` (build `20221129-222809`) |
| PB firmware string | `0.5.7` (`init.js` header) |
| loader | `0.2.2` (`app.js` header) |
| mongoose-os | `2.17.0` (`gc31a745`) |
| arch | `esp32` |
| fs | ~228 KB used region, SPIFFS-style, ~113 KB free |
| OTA | slot 0 active, committed; A/B with revert available |

## Why this matters for each goal

| Your goal | Where it lives | Feasible remotely? |
|-----------|----------------|--------------------|
| Read temps / set target | control board via ESP32 RPC | ✅ yes, trivially |
| Better app (local or cloud) | ESP32 RPC / cloud WS | ✅ yes |
| Custom logic on the ESP32 | `init.js` (mJS) | ✅ edit + `FS.Put` |
| Direct igniter/auger/fan control | control board only | ❌ not exposed |
| True PID temp loop | control board algorithm | ❌ replace board (see doc 07) |
| Custom LCD content | control board only | ❌ replace board |
