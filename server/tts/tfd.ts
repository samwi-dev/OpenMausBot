import type { TfdCredential } from "../tfd-credential.ts";
import type { Audio, Voice } from "./elevenlabs.ts";

const VOICES = ["serena", "vivian", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee"];

function refusal(status: number): string {
  if (status === 401 || status === 403) return "TFD rejected the key. Check the TFD engine in Settings → Engines.";
  if (status === 429) return "TFD is rate-limiting speech. Wait a moment and try again.";
  return `TFD voice failed (HTTP ${status}). Try again later.`;
}

export async function listVoices(): Promise<Voice[]> {
  return VOICES.map((id) => ({ id, label: id }));
}

export async function synthesize(text: string, voiceId: string, cred: TfdCredential): Promise<Audio> {
  let response: Response;
  try {
    response = await fetch(`${cred.url}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${cred.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen3-tts", input: text, voice: voiceId, response_format: "mp3" }),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("TFD voice timed out. Try again.");
    }
    throw new Error("Could not reach TFD voice. Check your connection.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    // Remote error bodies can echo credentials or request text.
    throw new Error(refusal(response.status));
  }
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "audio/mpeg" && mime !== "audio/mp3" && mime !== "application/octet-stream") {
    await response.body?.cancel();
    throw new Error("TFD returned an unexpected audio format. Try again later.");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new Error("TFD audio download was interrupted. Try again.");
  }
  if (!bytes.byteLength) throw new Error("TFD returned empty audio. Try again.");
  return { bytes, mime: "audio/mpeg" };
}
