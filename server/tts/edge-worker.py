"""Long-lived edge-tts worker: one JSON request per stdin line, one JSON reply per stdout line."""
import asyncio
import base64
import json
import sys

import edge_tts


async def synthesize(text, voice):
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    if not audio:
        raise RuntimeError("no audio")
    return base64.b64encode(bytes(audio)).decode("ascii")


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        req_id = None
        try:
            req = json.loads(line)
            req_id = req["id"]
            reply = {"id": req_id, "ok": True, "audio": asyncio.run(synthesize(req["text"], req["voice"]))}
        except Exception:
            reply = {"id": req_id, "ok": False}
        sys.stdout.write(json.dumps(reply) + chr(10))
        sys.stdout.flush()


main()
