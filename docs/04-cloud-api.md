# 04 — Dansons Cloud API

Two hosts, two roles. Both were characterized from the router (DNS query logs + banner
probes); the WebSocket protocol is fully described because the device side of it is in
`init.js`.

## Hosts

| Host | Role | Infra (observed) |
|------|------|------------------|
| `api-prod.dansonscorp.com` | REST API (accounts, devices, history) | **Laravel/PHP** on **Azure App Service**, `nginx/1.28`, `dansons_api_session` + `XSRF-TOKEN` cookies, `40.119.12.82` (southcentralus) |
| `socket.dansonscorp.com` | Realtime device ↔ app relay | **WebSocket** fronted by **Fastly** (`151.101.x`, `x-served-by: cache-*`) |

DNS evidence from your BIND logs (`/var/log/named/`):
- `<GRILL_IP>` (the smoker) → `socket.dansonscorp.com` only.
- `192.168.0.131` (the phone app) → `socket.dansonscorp.com` **and** `api-prod.dansonscorp.com`.
- The AWS IoT ATS endpoints in your logs (`a1da1wdr1p8s0l-ats.iot.us-east-2…`, etc.)
  belong to **other** devices on the LAN (a HALO grill at `.101`, a dev box at `.150`) —
  **not** this Pit Boss.

## Device ↔ cloud WebSocket protocol (fully known)

The ESP32 connects out to:

```
wss (https upgrade)  ->  https://socket.dansonscorp.com/from/<deviceId>
                         e.g. .../from/PBV-XXXXXXXXXXXX
```

Connection is opened only when the grill is **on** (`moduleIsOn || lastWasOn`) and WiFi is
up. Update cadence: `wsFastInterval` (5 s) while an app is actively watching (kept alive by
`PB.WiFiAwakeWDT`), else `wsSlowInterval` (60 s).

### Device → cloud (status push)

```json
{
  "id": -1,
  "src": "PBV-XXXXXXXXXXXX",
  "status": ["<sc_11 hex>", "<sc_12 hex>"],   // whichever are present
  "data":  { ...vData... },                   // optional, from PB.SetVirtualData
  "pState": "<string>"                         // optional, echoes last setPState
}
```

`status[]` carries the **same hex frames** as `PB.GetState`, so a cloud client decodes them
with the exact logic in doc 03.

### Cloud → device (command / control)

The cloud drives the grill by sending an RPC envelope the device executes locally:

```json
{ "id": 1234, "method": "PB.SendMCUCommand", "params": { "command": "FE0501020500FF" } }
```

or a UI hint:

```json
{ "setPState": "<opaque app state string>" }
```

The device runs `RPC.call(RPC.LOCAL, method, params, …)` and replies:

```json
{ "id": 1234, "src": "PBV-XXXXXXXXXXXX", "result": <resp> }
// or on error:
{ "id": 1234, "src": "PBV-XXXXXXXXXXXX", "error": { "code": -1, "message": "..." } }
```

**Key takeaway:** the cloud has *no special powers*. It controls the grill with the same
`PB.*` methods you can call locally. Anything the app can do through the cloud, you can do
directly on the LAN — usually with lower latency and no dependency.

## REST API (`api-prod.dansonscorp.com`)

Characterized, not fully mapped (mapping it fully needs the app's traffic or token):

- `GET /` → `{"message":"Welcome"}` (200).
- `GET /api` → 200; `GET /api/v1` → 404 (versioning differs).
- `GET /health` → 200.
- Session model is Laravel: `XSRF-TOKEN` (readable) + `dansons_api_session` (httponly),
  both AES-encrypted cookies (`{iv,value,mac,tag}` base64). Expect CSRF-token + bearer/
  session auth on write endpoints.
- Typical Dansons app flows (inferred): user auth/login, list devices for the account,
  bind a device by `deviceId`, fetch cook history / grill metadata, push firmware manifest.

To map it precisely, capture the phone app's HTTPS with a proxy you trust (mitmproxy) —
you own the network, and the app pins to public CAs (LE/Sectigo), so a proxy CA installed
on *your* phone is enough. See doc 05 for the interception options.

## Interception summary (you own the router + BIND)

1. **DNS redirect (cleanest):** add a zone/override for `socket.dansonscorp.com` →
   your box in BIND. Terminate the WebSocket with your own server, log frames, and relay
   upstream. Because the device validates TLS against `ca.pem` (LE/Sectigo/Comodo roots),
   you either (a) present a cert chaining to one of those for `socket.dansonscorp.com`
   (you don't control that domain, so hard), or (b) **replace `ca.pem` on the device**
   with your own root via `FS.Put` — trivial here since RPC is open. Then your relay's
   cert validates.
2. **Skip interception entirely:** for a "better app," just talk to the device locally
   (doc 02) and/or stand up your own cloud relay that the device points to (change `wsUrl`
   in a modified `init.js`, doc 08). Cleaner than MITM.
