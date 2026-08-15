# 02 — Local RPC API (Mongoose OS + PB.*)

The ESP32 exposes RPC over HTTP on port 80. **No authentication** is enforced on this
device (see doc 05), so every method below is callable directly.

## Transport

```
POST http://<GRILL_IP>/rpc/<Method>
Content-Type: application/json

{ ...params... }
```

- A bodyless POST can hang; always send at least `{}`. `GET http://ip/rpc/<Method>` also
  works for no-arg methods.
- CORS is wide open (`Access-Control-Allow-Origin: *`), so a browser page can call it too.
- Responses are JSON. Errors come back as `{"error": <code>, "message": "..."}`.

There is also a **BLE GATT** RPC channel (`rpc.gatts.enable=true`, `sec_level=0`,
no pairing required) and the outbound **cloud WebSocket** channel — same methods, three
pipes. See docs 03/04.

## Method inventory (`RPC.List`)

### Pit Boss application methods (defined in `init.js`)
| Method | Params | Purpose |
|--------|--------|---------|
| `PB.GetState` | `{psw?}` | Latest `sc_11`+`sc_12` frames (hex). Decode per doc 03. |
| `PB.SendMCUCommand` | `{command:"<hex>", psw?}` | Send a raw `FE..FF` frame to the control board. **This is the only write path to the grill.** |
| `PB.GetFirmwareVersion` | — | `{"firmwareVersion":"0.5.7"}` |
| `PB.GetTime` | — | `{time: <uptime_s>}` |
| `PB.GetVirtualData` / `PB.SetVirtualData` | `{...}` | App-defined "virtual data" blob relayed to the cloud (e.g. recipe/UI state). Only while grill is on. |
| `PB.DebugPState` | `{psw?}` | Returns the `pState` string the cloud last pushed. |
| `PB.SetMCU_UpdateFrequency` | `{frequency:<s>}` | How often the ESP32 polls the control board. |
| `PB.SetWiFiUpdateFrequency` | `{fast:<s>, slow:<s>, save?:bool}` | Cloud push cadence (fast when app is watching, slow otherwise). |
| `PB.WiFiAwakeWDT` | `{psw?}` | Kick a 5-min watchdog that keeps cloud updates in "fast" mode. |
| `PB.RenameDevice` | `{name, psw?}` | Renames `device.id` (keeps `PBV-` prefix). |
| `PB.SetWifiCredentials` | `{ssid, pass(hex,codec'd), psw?}` | Set STA WiFi (password is codec-obfuscated, see doc 06). |
| `PB.SetDevicePassword` | `{newPassword(hex), psw?}` | Sets the grill's device password (stored codec'd in `extconfig.json`). |

### Firmware-loader methods (defined in `app.js`, "PitBoss Loader 0.2.2")
| Method | Purpose |
|--------|---------|
| `PBL.GetLoaderVersion` | `{"loaderVersion":"0.2.2"}` |
| `PBL.LoadFirmware` | Downloads a JS app in chunks from a URL (currently short-circuited/disabled in code). |
| `PBL.LoadFirmwareStatus` | Progress of the above. |
| `PBL.CopyFile` | `{src,dst}` — copies a file on the device FS. |
| `PBL.StartWifiScan` / `PBL.GetWifiScanStatus` | WiFi survey. |

### Stock Mongoose OS methods (native, always present)
`Sys.GetInfo`, `Sys.GetUID`, `Sys.Reboot`, `Sys.SetDebug`,
`Config.Get`, `Config.Set`, `Config.Save`,
`FS.List`, `FS.ListExt`, `FS.Get`, `FS.Put`, `FS.Remove`, `FS.Rename`, `FS.Mkfs`, `FS.Mount`, `FS.Umount`,
`Dev.Read`, `Dev.Write`, `Dev.Erase`, `Dev.Create`, `Dev.Remove` (raw flash access),
`OTA.Update`, `OTA.Begin`, `OTA.Write`, `OTA.End`, `OTA.Commit`, `OTA.Revert`, `OTA.CreateSnapshot`, `OTA.Status`, `OTA.GetBootState`, `OTA.SetBootState`,
`Wifi.Scan`, `Wifi.SetupSTA`, `Wifi.SetupAP`,
`RPC.List`, `RPC.Describe`, `RPC.Ping`.

> The presence of unauthenticated `FS.*`, `Dev.*`, `Config.*`, and `OTA.*` is what makes
> the device fully owner-controllable — and also a security exposure (doc 05).

## The `psw` parameter and why it's currently a no-op

Every sensitive `PB.*` handler calls `checkPassword(params)`. In `init.js`:

```js
function checkPassword(params) {
  if (grillPassword === "") return true;   // <-- no password set == allow all
  ...
}
```

`grillPassword` is only non-empty if a codec-obfuscated `extconfig.json` exists on the FS.
Your device has **no `extconfig.json`**, so `grillPassword === ""` and **all methods are
open**. If you ever set a device password in the app, calls must include a rolling,
time-based `psw` (construction in doc 06).

## Useful examples

```bash
IP=<GRILL_IP>

# device identity / health
curl -s "http://$IP/rpc/Sys.GetInfo"

# full running config (⚠ includes wifi passwords in cleartext)
curl -s "http://$IP/rpc/Config.Get"

# just one config subtree
curl -s "http://$IP/rpc/Config.Get" -d '{"key":"wifi.sta"}'

# live grill state (raw frames)
curl -s "http://$IP/rpc/PB.GetState"

# set target temperature to 250F  (FE0501 + 2 5 0 + FF)
curl -s "http://$IP/rpc/PB.SendMCUCommand" -d '{"command":"FE0501020500FF"}'

# read a file off the device (base64, chunked)
curl -s "http://$IP/rpc/FS.Get" -d '{"filename":"init.js","offset":0,"len":1024}'

# write a file back (base64 data) — how you deploy a modified init.js
curl -s "http://$IP/rpc/FS.Put" -d '{"filename":"init.js","data":"<base64>"}'

# reboot to load changes
curl -s "http://$IP/rpc/Sys.Reboot" -d '{}'
```

`FS.Get` returns `{"data":"<base64>","left":<bytes_remaining>}`; loop with increasing
`offset` until `left == 0`. `tools/pbclient.py` and the backup script both do this.
