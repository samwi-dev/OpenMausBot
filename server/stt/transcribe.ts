import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.ts";
import { tfdCredential } from "../tfd-credential.ts";
import { transcribe } from "./tfd.ts";

const LIMIT = 5_000_000;

/** Raw request bytes, or null once they pass `limit` (the rest of the upload is discarded). */
function readRaw(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > limit) { over = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function handleTranscribe(req: IncomingMessage, cfg: AppConfig): Promise<{ status: number; body: unknown }> {
  const audio = await readRaw(req, LIMIT);
  if (!audio) return { status: 413, body: { error: "audio is limited to 5 MB" } };
  if (!audio.length) return { status: 400, body: { error: "audio required" } };
  const cred = tfdCredential(cfg);
  if (!cred) return { status: 409, body: { error: "Add a TFD engine in Settings → Engines to use TFD voice." } };
  try {
    return { status: 200, body: { text: await transcribe(new Uint8Array(audio), cred) } };
  } catch (e) {
    return { status: 502, body: { error: e instanceof Error ? e.message : "TFD speech recognition failed. Try again later." } };
  }
}
