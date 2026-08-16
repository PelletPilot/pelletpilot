#!/usr/bin/env python3
"""
pbclient.py - PelletPilot local client for a pellet-grill WiFi controller
(Mongoose OS on ESP32) over its unauthenticated HTTP-RPC interface.

Control board: PBV family. Set the grill IP via the PELLETPILOT_GRILL_IP env var
(or pass it as the 2nd CLI arg).

This talks to http://<ip>/rpc/<Method> using the same PB.* RPC methods the
vendor cloud uses. No cloud, no app, no account required as long as the grill
has no device password set (grillPassword == "").

Decoding is validated app-accurate against the pytboss PBV control_board spec
(see reference/grills.json).
"""
import json
import os
import sys
import time
import urllib.request

DEFAULT_IP = os.environ.get("PELLETPILOT_GRILL_IP", "192.168.4.1")
GRILL_TEMP_SENTINEL = 960  # probe reads 960 when disconnected


class PitBoss:
    def __init__(self, ip=DEFAULT_IP, password=None, timeout=8):
        self.ip = ip
        self.timeout = timeout
        self.password = password  # plaintext device password, if one is set

    # ---- transport -------------------------------------------------------
    def rpc(self, method, params=None):
        url = f"http://{self.ip}/rpc/{method}"
        body = json.dumps(params or {}).encode()
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            raw = r.read()
        return json.loads(raw) if raw else None

    # ---- info ------------------------------------------------------------
    def info(self):
        return self.rpc("Sys.GetInfo")

    def fw_version(self):
        return self.rpc("PB.GetFirmwareVersion")

    def rpc_list(self):
        return self.rpc("RPC.List")

    # ---- state -----------------------------------------------------------
    def get_state(self):
        """Return decoded live state (merges sc_11 status + sc_12 temps)."""
        raw = self.rpc("PB.GetState") or {}
        out = {"raw": raw}
        if raw.get("sc_11"):
            out.update(decode_status(raw["sc_11"]))
        if raw.get("sc_12"):
            out.update(decode_temps(raw["sc_12"]))
        return out

    # ---- commands (setpoint-level only; see docs/07) ---------------------
    def send_mcu(self, hex_cmd):
        """Send a raw MCU command frame (hex string, incl. FE.. FF)."""
        p = {"command": hex_cmd}
        if self.password is not None:
            p["psw"] = self.password  # NOTE: real auth needs the rolling codec
        return self.rpc("PB.SendMCUCommand", p)

    def set_temperature(self, temp_f):
        return self.send_mcu(cmd_set_temperature(temp_f))

    def turn_off(self):
        return self.send_mcu("FE0102FF")

    # No turn_on: protocol has no remote power-on; grill must be started physically.

    def light_on(self):
        return self.send_mcu("FE0201FF")

    def light_off(self):
        return self.send_mcu("FE0200FF")

    def prime_on(self):
        return self.send_mcu("FE0801FF")

    def prime_off(self):
        return self.send_mcu("FE0800FF")

    def set_fahrenheit(self):
        return self.send_mcu("FE0901FF")

    def set_celsius(self):
        return self.send_mcu("FE0902FF")


# ---- command builders ----------------------------------------------------
def _fmt_hex(n):
    return "%02X" % (n & 0xFF)


def cmd_set_temperature(temp_f):
    """FE0501 + hundreds + tens + ones + FF  (each digit as its own byte)."""
    t = int(temp_f)
    h, te, o = t // 100, (t % 100) // 10, t % 10
    return "FE0501" + _fmt_hex(h) + _fmt_hex(te) + _fmt_hex(o) + "FF"


# ---- decoders (PBV control board) ---------------------------------------
def _parts(hexstr):
    """Bytes of the frame as ints; index 0 == 0xFE (matches pytboss/firmware)."""
    b = bytes.fromhex(hexstr)
    return list(b)


def _temp(parts, i):
    """3-digit decimal temp: parts[i]*100 + parts[i+1]*10 + parts[i+2]."""
    if i + 2 >= len(parts):
        return None
    v = parts[i] * 100 + parts[i + 1] * 10 + parts[i + 2]
    return v


def decode_temps(sc_12_hex):
    """Decode FE0C 'temperatures' frame -> dict."""
    p = _parts(sc_12_hex)
    if len(p) < 27 or p[1] != 0x0C:
        return {}
    return {
        "p1_temp": _temp(p, 5),
        "p2_temp": _temp(p, 8),
        "p3_temp": _temp(p, 11),
        "p4_temp": _temp(p, 14),
        "smoker_act_temp": _temp(p, 17),
        "grill_set_temp": _temp(p, 20),
        "grill_temp": _temp(p, 23),
        "is_fahrenheit": p[26] == 1,
    }


def decode_status(sc_11_hex):
    """Decode FE0B 'status' frame -> dict (errors + actuator states)."""
    p = _parts(sc_11_hex)
    if len(p) < 44 or p[1] != 0x0B:
        return {}
    return {
        "module_is_on": p[24] == 1,
        "err_1": p[25] == 1,
        "err_2": p[26] == 1,
        "err_3": p[27] == 1,
        "high_temp_err": p[28] == 1,
        "fan_err": p[29] == 1,
        "hot_err": p[30] == 1,
        "motor_err": p[31] == 1,
        "no_pellets": p[32] == 1,
        "er_l": p[33] == 1,
        # actuator STATE telemetry (read-only; cannot be commanded directly):
        "fan_state": p[34] == 1,       # combustion fan
        "hot_state": p[35] == 1,       # igniter hot-rod
        "motor_state": p[36] == 1,     # auger motor
        "light_state": p[37] == 1,
        "prime_state": p[38] == 1,
        "recipe_step": p[40],
        "recipe_time_s": p[41] * 3600 + p[42] * 60 + p[43],
    }


# ---- CLI -----------------------------------------------------------------
def main():
    ip = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_IP
    pb = PitBoss(ip)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "state"

    if cmd == "info":
        print(json.dumps(pb.info(), indent=2))
    elif cmd == "state":
        print(json.dumps(pb.get_state(), indent=2))
    elif cmd == "watch":
        while True:
            s = pb.get_state()
            print(
                "set=%s act=%s p1=%s p2=%s on=%s fan=%s ign=%s auger=%s"
                % (
                    s.get("grill_set_temp"),
                    s.get("grill_temp"),
                    s.get("p1_temp"),
                    s.get("p2_temp"),
                    s.get("module_is_on"),
                    s.get("fan_state"),
                    s.get("hot_state"),
                    s.get("motor_state"),
                )
            )
            time.sleep(5)
    elif cmd == "settemp":
        print(pb.set_temperature(int(sys.argv[3])))
    else:
        print("usage: pbclient.py [info|state|watch|settemp <F>] [ip] [args]")


if __name__ == "__main__":
    main()
