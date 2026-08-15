# @pelletpilot/server — self-host server

Open-source PelletPilot server. **No authentication** (LAN-trusted). Manages your
grills/smokers and records **cook history**. Runs in Docker.

> The hosted public PelletPilot server (user accounts, cloud cook log) is separate.
> This OSS build is local-first: it polls your devices on the LAN and stores everything
> in a local SQLite file.

## Run (Docker)

```bash
docker compose up -d --build
# server on http://<host>:8080 ; data persists in ./data
```

Add your grill (by LAN IP). Capabilities come from a template + optional override;
control board is auto-detected from firmware when reachable:

```bash
curl -X POST http://localhost:8080/api/devices \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mac Daddy","host":"192.168.0.177","templateId":"vertical-smoker"}'
```

The poller then samples it every 10s, auto-starting a **cook** when it powers on and
ending it after it's been off a while.

## Capability templates

`GET /api/templates` → `pellet-grill`, `pellet-grill-chamber-only`,
`pellet-grill-smoker-box`, `vertical-smoker`. Each prefills
`{ meatProbes, smokerBox, lights, minTemp, maxTemp, tempStep }`; override any field when
adding/patching a device. (Defined in `@pelletpilot/protocol` so the app shares them.)

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/templates` | capability templates |
| GET/POST | `/api/devices` | list / add device |
| GET/PATCH/DELETE | `/api/devices/:id` | manage a device |
| GET | `/api/devices/:id/state` | latest decoded live state |
| POST | `/api/devices/:id/command` | `{setTemp}` or raw `{command}` |
| GET | `/api/devices/:id/cooks` | cook history list |
| POST | `/api/devices/:id/cook/start` | start a cook manually |
| GET | `/api/cooks/:cookId` | cook + events |
| GET | `/api/cooks/:cookId/samples` | time-series samples |
| POST | `/api/cooks/:cookId/stop` | end a cook |
| WS | `/api/devices/:id/live` | live state push (~3s) |

## Data model (SQLite)

- **devices** — id, name, host, model, control_board, capabilities(JSON)
- **cooks** — a session per power-on (device_id, started_at, ended_at, title, notes)
- **samples** — set/grill temp, probes[], fan/auger/igniter, fault flags, per interval
- **events** — flameout / high-temp / fault edges within a cook

## Dev (without Docker)

```bash
pnpm install
pnpm --filter @pelletpilot/protocol build
pnpm --filter @pelletpilot/server dev
```

## Security

No auth by design — **only run on a trusted LAN**, never port-forward it. Home Assistant
users can run it as a Docker/compose service alongside HA (a dedicated HA add-on is a
possible future packaging).
