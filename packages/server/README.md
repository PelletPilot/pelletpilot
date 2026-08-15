# packages/server — PelletPilot cloud (self-hostable + public API)

> Status: 🟡 design. This README is the spec; implementation lands next.

The server is what lets your grill and your phone reach each other from anywhere, on
infrastructure **you** own — or via the hosted PelletPilot public API for people who don't
want to self-host. It implements the same device-facing protocol the grill firmware already
speaks, so a lightly-modified firmware (or the stock one repointed) connects straight in.

## Responsibilities

1. **Device ingress (WebSocket).** Accept the grill's outbound connection at
   `wss://<host>/from/<deviceId>` and speak the documented envelope
   ([`../../docs/04-cloud-api.md`](../../docs/04-cloud-api.md)):
   - device → server: `{ id:-1, src, status:[sc11,sc12], data?, pState? }`
   - server → device: `{ id, method:"PB.SendMCUCommand", params:{command} }` → device replies `{ id, src, result|error }`
   Decode `status[]` with `@pelletpilot/protocol`.
2. **Public API (REST + WebSocket).** For apps/integrations:
   - `POST /auth/*` — user accounts (JWT).
   - `GET /devices`, `GET /devices/:id/state`, `POST /devices/:id/command` (set temp, etc.).
   - `GET /devices/:id/history` — cook/probe time series.
   - `WS /subscribe/:id` — live decoded state push to the app.
3. **Persistence.** Users, devices, bindings, cook history, alerts.
4. **Alerts.** Probe-target reached, flameout/`noPellets`, high-temp, lid-open recovery.

## Proposed stack (self-host friendly)

- **Runtime:** Node 20+, TypeScript, **Fastify** + `ws`.
- **DB:** SQLite (via Drizzle) by default → drop-in Postgres for scale. `DATABASE_URL` in `.env`.
- **Auth:** JWT for users; per-device tokens for grills.
- **Deploy:** single container; `docker compose up`. No cloud lock-in.

## Design principles

- **The cloud has no special powers.** It controls grills with the same `PB.*` methods a LAN
  client uses — so local-only mode and cloud mode share one code path.
- **Safety commands are idempotent and rate-limited.** Never queue-flood the auger setpoint.
- **Bring-your-own-firmware.** Document exactly what a grill must connect to so anyone can
  point a device here by changing one URL (`wsUrl`) — see `packages/firmware`.

## Open questions (decide before coding)

- Multi-tenant public API vs. single-tenant self-host — one codebase, feature-flagged?
- Device auth for the public instance (the stock firmware has no client cert; add a
  provisioning token via modified firmware, or accept deviceId + a shared secret?).
