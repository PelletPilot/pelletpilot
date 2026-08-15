#!/usr/bin/env python3
"""
decode_state.py - Standalone decoder for Pit Boss PBV status/temperature frames.

Usage:
    python3 decode_state.py FE0C0202....FF [FE0B0202....FF ...]
    python3 decode_state.py            # decodes the built-in sample frames

Frame format:  FE <type> <payload...> FF
    type 0x0B = status  (errors + actuator states + recipe)
    type 0x0C = temperatures (probes, grill set/actual)

Byte indexing includes the leading 0xFE at index 0 (matches device firmware,
where powerStatusPos == 24). Temperatures are 3-digit decimal:
    value = b[i]*100 + b[i+1]*10 + b[i+2]      (960 == probe disconnected)
"""
import sys

from pbclient import decode_status, decode_temps  # reuse validated decoders

SAMPLES = [
    "FE0C02020509060009060001070200000002020302020502020301FF",
    "FE0B020205090600090600010702000000020209020209010100000000000000000001000000000100000000FF",
]


def decode(frame):
    frame = frame.strip().upper()
    b = bytes.fromhex(frame)
    if len(b) < 2 or b[0] != 0xFE:
        return {"error": "not a FE..FF frame"}
    if b[1] == 0x0C:
        return {"type": "temperatures(0x0C)", **decode_temps(frame)}
    if b[1] == 0x0B:
        return {"type": "status(0x0B)", **decode_status(frame)}
    return {"type": "0x%02X (unknown)" % b[1], "len": len(b)}


if __name__ == "__main__":
    frames = sys.argv[1:] or SAMPLES
    for f in frames:
        print(f"\n{f}")
        for k, v in decode(f).items():
            print(f"  {k:20s} {v}")
