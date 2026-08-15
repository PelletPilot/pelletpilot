# 05 — Security Findings

This is your own device, so treat this as an owner's exposure assessment — what any other
device on your LAN (or a guest, or a compromised IoT neighbor) could do to the smoker, and
what leaks.

## Summary table

| # | Finding | Severity (on your LAN) | Notes |
|---|---------|------------------------|-------|
| 1 | HTTP :80 serves the **entire filesystem with no auth** | High | Directory index + `FS.Get` of every file |
| 2 | **WiFi passwords in cleartext** via `Config.Get` / `conf9.json` | High | 3 networks incl. factory test SSIDs |
| 3 | **Full RPC unauthenticated** (`FS.*`,`Dev.*`,`Config.*`,`OTA.*`) | High | Read/write flash, reflash, reconfigure |
| 4 | **Grill controllable with no auth** (`PB.SendMCUCommand`) | High→Safety | Anyone on-LAN can change temp / turn off |
| 5 | Device password gate is bypassed when unset | Medium | `checkPassword` returns true if `grillPassword==""` |
| 6 | **BLE GATT RPC open**, no pairing (`sec_level=0`) | Medium | Same RPC surface over Bluetooth, ~physical range |
| 7 | Weak, keyed-but-hardcoded **codec** for passwords/wifi | Medium | Keys are in `init.js` (doc 06) |
| 8 | SoftAP fallback `PitBoss_P_??????` / pass `PitBoss` | Low | Known default AP creds |

## Details

### 1–2. Everything is readable
`GET http://<GRILL_IP>/` returns a directory listing; every file is downloadable, and
`Config.Get` dumps the running config. That config contains, in cleartext:

```
wifi.sta   ssid="<HOME_SSID>"       pass="<redacted>"
wifi.sta1  ssid="<factory-ssid-1>"  pass="<redacted>"   ← factory/test network (not yours)
wifi.sta2  ssid="<factory-ssid-2>"  pass="<redacted>"   ← factory/test network (not yours)
```
(Real values are in the gitignored `private/device-facts.md`.)

`sta1`/`sta2` are almost certainly **Dansons factory provisioning networks** left in the
shipped config (the phone-number-style passwords are a tell). Harmless to you directly, but
they're a supply-chain artifact and they sit in your grill's config forever until cleared.

> Recommendation: clear `wifi.sta1`/`wifi.sta2` (`Config.Set` + `Config.Save`) so your
> grill isn't carrying someone else's credentials, and be aware **your** WiFi password is
> retrievable by anything on the LAN that can reach port 80.

### 3–4. Full control, no auth
`RPC.List` exposes `FS.Put`/`Dev.Write`/`OTA.Update` (persistent compromise) and
`PB.SendMCUCommand` (physical actuation: change setpoint, power off mid-cook). None require
credentials. On a trusted home LAN this is what makes your project *easy*; it's also why
you should not expose port 80 / this device to untrusted networks or port-forward it.

### 5. The password gate
Setting a device password in the app writes a codec-obfuscated `extconfig.json`. Only then
does `checkPassword` actually enforce anything, and even then the scheme is a time-rolling
XOR codec with a key baked into the firmware (doc 06) — obscurity, not real crypto. It
raises the bar slightly against casual LAN callers; it is not a strong control.

### 6. Bluetooth
`bt.enable=true`, `adv_enable=true`, `gatts.require_pairing=false`, `sec_level=0`, and
`rpc.gatts.enable=true`. The same RPC methods are reachable over BLE GATT with no pairing,
within Bluetooth range. `pytboss` uses exactly this path (`ble.py`).

## Hardening (if you want to lock it down after your project)

- Set a device password (doc 06) — modest benefit.
- Put the grill on an **isolated IoT VLAN/SSID** with no inbound from your main LAN, and
  block its outbound except what it needs (`socket.dansonscorp.com:443`) if you keep the
  cloud; block all outbound if you go local-only.
- Never port-forward it. Never put it on a guest network you don't control.
- Consider disabling BT in config if you only use WiFi.

## Offensive-but-authorized notes (your device, your call)

These are enablers for *your* project, listed plainly:

- Replacing `ca.pem` (`FS.Put`) lets you MITM the cloud with your own root.
- Editing `init.js` (`FS.Put` + reboot) lets you repoint `wsUrl` to your own relay.
- `Dev.Read` dumps raw flash for offline analysis/backup; `OTA.*` can flash a self-built
  Mongoose OS image (risky — doc 08).
