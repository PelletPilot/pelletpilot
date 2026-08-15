# 08 — Developer Guide

Practical recipes for building on this device. Three tiers, lowest-risk first:
**(A) talk to it**, **(B) modify the ESP32 app**, **(C) native firmware / hardware**.

---

## A. Build an app against the local API (no firmware changes)

This is the fastest path to "a better app," and it's cloud-free.

### A.1 Read state
```python
from pbclient import PitBoss      # tools/pbclient.py
pb = PitBoss("<GRILL_IP>")
s = pb.get_state()
print(s["grill_set_temp"], s["grill_temp"], s["p3_temp"])
```
`get_state()` merges `sc_11` (status/actuators/errors) and `sc_12` (temps) and decodes both.
Validated app-accurate (doc 03).

### A.2 Command it (setpoint-level — the only writes available)
```python
pb.set_temperature(250)   # FE0501020500FF
pb.light_on()             # FE0201FF
pb.turn_off()             # FE0102FF
```
See doc 03 for the full 9-verb command set. There is **no** auger/fan/igniter command.

### A.3 Transport options
- **HTTP** (used here): request/response only — you must poll `get_state()`. Simplest.
- **BLE GATT**: same RPC over Bluetooth, no pairing; use `pytboss` (`ble.py`) if you want
  push-style state/vData callbacks without cloud.
- **Cloud WebSocket**: `pytboss` (`wss.py`) connects through `socket.dansonscorp.com` for
  remote (off-LAN) access; needs a Dansons account/token.

### A.4 Just use pytboss
[`pytboss`](https://github.com/dknowles2/pytboss) already implements all three transports,
the codec, and the decode (`reference/grills.json` is its spec file). For a Home Assistant
setup, the companion integration exists. Our `tools/` are a dependency-free equivalent for
this specific device.

### A.5 A "smart hold" supervisor (Path A PID) — sketch
```python
# pid_supervisor.py  — outer loop that nudges the setpoint. See doc 07 for caveats.
import time
from pbclient import PitBoss

pb = PitBoss("<GRILL_IP>")
DESIRED = 225            # what you actually want the chamber to hold
Kp, Ki = 0.6, 0.02
integ = 0.0
last_cmd = None

while True:
    s = pb.get_state()
    pv = s.get("grill_temp")
    if pv:
        err = DESIRED - pv
        integ = max(-50, min(50, integ + err))     # clamp integral
        u = Kp*err + Ki*integ                        # controller output
        cmd = DESIRED + u                            # bias the setpoint
        cmd = int(round(max(180, min(300, cmd)) / 5) * 5)   # clamp + 5°F quantize
        if cmd != last_cmd:
            pb.set_temperature(cmd); last_cmd = cmd
    time.sleep(45)        # slow outer loop — do NOT run fast, you'll oscillate
```
This is a *soft* improvement over hysteresis (doc 07 explains why it can't be a true PID).

---

## B. Modify the ESP32 application (mJS)

The whole app is JavaScript in `firmware-backup/`. You can edit `init.js` and push it back.
The native Mongoose OS core (which serves RPC) is separate, so a broken `init.js` won't
brick RPC — you can always push a fix.

### B.1 Deploy workflow
```bash
IP=<GRILL_IP>
# 1) edit firmware-backup/init.js
# 2) push it (base64) via FS.Put
python3 - <<'PY'
import base64, json, urllib.request
ip="<GRILL_IP>"
data=base64.b64encode(open("firmware-backup/init.js","rb").read()).decode()
req=urllib.request.Request(f"http://{ip}/rpc/FS.Put",
    data=json.dumps({"filename":"init.js","data":data}).encode(),
    headers={"Content-Type":"application/json"})
print(urllib.request.urlopen(req,timeout=15).read())
PY
# 3) reboot
curl -s "http://$IP/rpc/Sys.Reboot" -d '{}'
```
For files >~4 KB, chunk `FS.Put` with `append` semantics, or rely on the loader's
`PBL.CopyFile`. Keep the pristine backup so you can always restore.

> ⚠ **Do not modify `wifi.sta`.** If you lose WiFi you must recover via the SoftAP
> (`PitBoss_P_??????` / `PitBoss`) or a USB-serial console on the ESP32. Everything else is
> safely reversible over the network.

### B.2 High-value mods
- **Point it at your own cloud:** change
  `let wsUrl = "https://socket.dansonscorp.com/from/" + deviceId;`
  to your relay. The device will send you the same status/RPC envelopes (doc 04) — you get
  full remote telemetry + control on your own server, no MITM.
- **Add local RPC methods:** `RPC.addHandler("PB.MyThing", function(p){...})` — e.g. expose
  decoded temps directly, add a local safety auto-shutoff on probe target, or push MQTT.
- **Faster local updates:** the ESP32 already polls every ~2 s; expose a cleaner
  event/stream if you add a small local WS.
- **Own root of trust:** `FS.Put` your own `ca.pem` to make the device trust your relay's
  TLS (doc 04/05).

### B.3 Rebuild the app from source?
`pytboss` ships a `mos.yml` and `fake_firmware/` — useful references if you want to
reconstruct a buildable Mongoose OS project. But for behavior changes you rarely need to;
editing the deployed `init.js` is enough.

---

## C. Native firmware & hardware (advanced)

### C.1 Dump native flash (backup / analysis)
`Dev.Read` reads raw flash regions; `OTA.CreateSnapshot` snapshots the running slot. Use
for a full offline backup before any OTA experiment. (These produce binary blobs, not
editable source.)

### C.2 Flash a custom native image (risky)
`OTA.Update`/`OTA.Begin`/`OTA.Write`/`OTA.End` accept a Mongoose OS firmware zip. You'd
build one with the `mos` tool (`mos build --platform esp32`). The device has A/B slots +
`OTA.Revert` and a `commit_timeout`, so an uncommitted bad image can roll back — but a
botched flash can still require USB recovery. Only do this if you specifically need native
code the mJS layer can't provide.

### C.3 Replace the control board (true PID) — see doc 07 Path B
The real path to owning igniter/auger/fan/probes/LCD. Keep the ESP32 and have your new
controller **emulate the `FE..FF` serial protocol** (encoders/decoders in `tools/`) so the
app + cloud keep working while your firmware runs PID underneath.

---

## Recovery cheat-sheet

| Situation | Recovery |
|-----------|----------|
| Broke `init.js` | RPC core still up → `FS.Put` the backup, reboot |
| Lost WiFi (bad `wifi.sta`) | Join SoftAP `PitBoss_P_??????`/`PitBoss`, `Config.Set` wifi, save |
| Bad OTA (uncommitted) | wait for `commit_timeout` or `OTA.Revert`; else USB reflash |
| Bricked native | USB-serial + `esptool`/`mos flash` (open the module) |
| Forgot device password | `FS.Remove` `extconfig.json` (RPC is unauth) → `grillPassword==""` |

## File map of the backup

| File | What it is |
|------|-----------|
| `init.js` | **The app** — PB.* handlers, MCU protocol, cloud WS (PBVNEW 0.5.7) |
| `app.js` | The loader (PitBoss Loader 0.2.2) — chunked FW download + wifi scan |
| `platform.js` | Platform constants (`powerStatusPos=24`, `psUartMessage` stub) |
| `api_*.js` | Mongoose OS mJS API bindings (uart, rpc, gpio, aws, ...) |
| `lib_ws.js` / `lib_http.js` | WebSocket / HTTP helper libs |
| `conf9.json` | User config (device id, aws thing, **wifi creds**) |
| `conf0.json` | Empty defaults (`{}`) |
| `ca.pem` | Trusted roots (ISRG X1 / Comodo / Sectigo) |
| `_Sys.GetInfo.json` etc. | Captured RPC snapshots |
