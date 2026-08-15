# 06 — The Codec (password / WiFi obfuscation)

`init.js` uses a small custom stream cipher (`codec`, `getCodecKey`, `getCodecTime`) to
obfuscate the device password and WiFi password, and to authenticate `psw`-bearing RPC
calls with a time-rolling key. It is **obscurity, not cryptography** — all keys are
hardcoded in the firmware you already have. Documented here for completeness and so you can
build/verify `psw` if you ever set a device password. A reference implementation also exists
in `pytboss/codec.py`.

## Hardcoded keys (from `init.js`)

| Purpose | Key bytes |
|---------|-----------|
| Device password (rolling auth + storage) | `8F 80 19 CF 77 6C FE B7` |
| WiFi password (`PB.SetWifiCredentials`) | `8F 80 27 CF 41 6C 45 B7` |
| `extconfig.json` password-at-rest | `C3 3A 77 F0 DA 52 6F 16` |

## Primitives

```js
getCodecTime()  =  floor( max(uptime_seconds - 5, 0) / 10 )   // 10s buckets

getCodecKey(key, time):        // derive a per-time key schedule from a base key
    x = []; l = time
    while key.length > 1:
        p = l % key.length
        v = key[p]; key.splice(p,1)
        x.push((v ^ l) & 0xff)
        l = (l*v + v) & 0xff
    x.push(key[0])
    return x

codec(data, key, paddingLen):  // symmetric; paddingLen>0 encodes (adds random pad +
                               // 0xFF marker), paddingLen==0 decodes (strips to marker)
```

`codec` is an XOR stream where each key byte is mutated by the plaintext/ciphertext as it
goes (a self-modifying keystream). With `paddingLen>0` it prepends `paddingLen` random bytes
+ a `0xFF` sentinel then encrypts; with `paddingLen==0` it decrypts and strips everything up
to and including the first `0xFF`.

## How the pieces are used

**Store a device password** (`PB.SetDevicePassword {newPassword:<hex>}`):
```
grillPassword = codec( fromHex(newPassword), DEVICE_KEY, 0 )
extconfig.json.psw = toHex( codec(grillPassword, EXTCFG_KEY, 4) )   // padded at rest
```

**Authenticate a call** (`checkPassword {psw:<hex>}`): the client must send, for the current
10-second bucket `x = getCodecTime()`:
```
psw_hex = toHex( codec( grillPassword, getCodecKey(DEVICE_KEY, x), 0_reverse ) )
```
The device accepts the current bucket `x` **or** `x+1` (clock-skew tolerance). Because the
key rolls every 10 s, a captured `psw` is only briefly replayable.

**Set WiFi** (`PB.SetWifiCredentials {ssid, pass:<hex>}`):
```
stored_pass = codec( fromHex(pass), WIFI_KEY, 0 )   // then written to wifi.sta.pass
```

## Practical implications

- If **no** device password is set (your current state), you can ignore all of this —
  `checkPassword` returns `true` and no `psw` is needed.
- If you set one, either compute `psw` per the above each call, or just use `pytboss`
  (`codec.py`) which implements it. The rolling key needs the device `uptime`
  (`PB.GetTime` → `{time}`), since `getCodecTime` is uptime-based, **not** wall-clock.
- The WiFi password stored in `wifi.sta.pass` that you read via `Config.Get` is the
  **cleartext** value (Mongoose stores it decoded); the codec only protects the value in
  transit through `PB.SetWifiCredentials`. So config-dump still leaks the real password
  (doc 05).
