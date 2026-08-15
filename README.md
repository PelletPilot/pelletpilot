# 🔥 PelletPilot

**Open firmware, self-hostable cloud, and a mobile web app for WiFi pellet grills & smokers.**

PelletPilot is an independent, open-source stack that talks to Pit Boss® / Dansons-style
pellet grills — locally over their WiFi module, or remotely through a cloud you can host
yourself (or use the public PelletPilot API). Read temps, set targets, watch your cook, and
build smarter control on top — without the vendor app or vendor cloud.

> **Not affiliated with, endorsed by, or connected to Dansons Inc. or Pit Boss®.** Those
> names are trademarks of their respective owners and are used here only to describe
> hardware compatibility. Use at your own risk (see [LICENSE](LICENSE) and
> [`docs/05-security-findings.md`](docs/05-security-findings.md)).

---

## What's in the box

| Component | Package | What it does | Status |
|-----------|---------|--------------|--------|
| **Protocol core** | [`@pelletpilot/protocol`](packages/protocol) | TypeScript codec for the `FE…FF` serial frames + the RPC client. One source of truth, shared by everything. | 🟢 usable |
| **Firmware** | [`pelletpilot/firmware`](https://github.com/pelletpilot/firmware) *(separate repo)* | Drop-in ESP32 app that points your grill at *your* cloud (v1: mJS; native ESP-IDF later). | 🟡 design |
| **Server** | [`packages/server`](packages/server) | Self-host server (Docker, **no auth**): device registry, capability templates, **cook history**. | 🟢 buildable |
| **Mobile web app** | [`packages/app`](packages/app) | Mobile-first PWA SPA — live dashboard, control, probe graphs, cook timers. | 🟡 design |
| **Python tools** | [`tools/`](tools) | Dependency-free CLI client + frame decoder (reference impl, validated app-accurate). | 🟢 usable |

The complete reverse-engineering of the device, protocol, and cloud lives in
[`docs/`](docs/) — start there if you want to understand *how* any of this works.

---

## Architecture

```
  ┌─────────────────────────┐        ┌──────────────────────────┐        ┌─────────────────┐
  │        THE GRILL         │        │   PelletPilot server     │        │  PelletPilot    │
  │                          │        │   (self-host or public)  │        │  web app (PWA)  │
  │  control board (PBV MCU) │        │                          │        │                 │
  │        ▲   │ FE..FF UART  │        │  • device WS ingress     │◀──WSS──▶│  live dashboard │
  │        │   ▼              │        │    /from/<deviceId>      │        │  set temp/probe │
  │   ┌──────────────┐  WiFi  │        │  • REST + WS public API  │        │  probe graphs   │
  │   │ ESP32 module │◀──────┼──WSS──▶│  • auth, history, alerts │        │                 │
  │   │  firmware    │        │        │  • @pelletpilot/protocol │        │ @pelletpilot/   │
  │   └──────────────┘        │        └──────────────────────────┘        │   protocol      │
  │        ▲ local HTTP/BLE   │              also: run 100% local ─────────▶└─────────────────┘
  └────────┼──────────────────┘              (app ↔ grill on the LAN, no cloud)
           │
   @pelletpilot/protocol also speaks directly to the grill on your LAN (no cloud required)
```

Three ways to run it:
1. **Local-only** — app talks straight to the grill's WiFi module on your LAN. No account, no cloud.
2. **Self-hosted** — run `packages/server`; your grill and phone reach each other from anywhere, on infrastructure you own.
3. **Public API** — point at the hosted PelletPilot cloud (optional, for people who don't want to self-host).

See [`docs/01-architecture.md`](docs/01-architecture.md) for the full teardown, and
[`docs/04-cloud-api.md`](docs/04-cloud-api.md) for the device↔cloud protocol we implement.

---

## Quick start (today)

The Python reference client already works against a grill on your LAN:

```bash
export PELLETPILOT_GRILL_IP=<your-grill-ip>   # find it in your DHCP leases
python3 tools/pbclient.py state               # decoded live state
python3 tools/pbclient.py watch               # poll every 5s
python3 tools/pbclient.py settemp 250         # set target (⚠ commands the grill)
```

TypeScript packages (installable) land as the monorepo fills in — see the roadmap.

---

## Roadmap

- [x] Reverse-engineer device, serial protocol, and cloud protocol ([`docs/`](docs))
- [x] Validated Python reference client + decoder ([`tools/`](tools))
- [ ] `@pelletpilot/protocol` — TS codec + client (in progress)
- [x] `packages/server` — self-host server (Docker, no auth): devices + capability templates + cook history (SQLite)
- [ ] hosted public server — user accounts + cloud cook log (separate from the OSS build)
- [ ] `packages/app` — mobile PWA SPA (dashboard, control, probe graphs)
- [ ] `pelletpilot/firmware` *(separate repo)* — drop-in ESP32 app that repoints the grill to a PelletPilot server
- [ ] Path-A "smart hold" supervisor (setpoint PID) — [`docs/07`](docs/07-pid-control-feasibility.md)
- [ ] Path-B control-board replacement reference design (true PID) — stretch

---

## Repo layout

```
pelletpilot/                     ← this repo (TS monorepo)
├── packages/
│   ├── protocol/   @pelletpilot/protocol — FE..FF codec + RPC client (TS)
│   ├── server/     self-hostable cloud + public API
│   └── app/        mobile web SPA (PWA)
├── tools/          python reference client + decoder
├── docs/           reverse-engineering & protocol reference (01–08)
├── reference/      third-party protocol data (pytboss grills.json — attribution in-file)
└── private/        LOCAL ONLY, gitignored — your device dump, creds, real IDs

pelletpilot/firmware             ← separate repo (different toolchain: mJS / ESP-IDF)
```

**Org layout (hybrid):** the three TypeScript components share `@pelletpilot/protocol`, so
they live together here for atomic changes + one CI. The **firmware** is a separate repo
([`pelletpilot/firmware`](https://github.com/pelletpilot/firmware)) because it's a different
language/toolchain with its own release cadence.

## Contributing & license

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE).

> **`private/` is gitignored and never published** — it holds the real device dump
> (WiFi passwords, third-party factory creds, and the vendor's proprietary firmware).
> Keep secrets there; the rest of the repo uses placeholders.
