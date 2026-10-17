import { z } from "zod";
import type { TfdCredential } from "../tfd-credential.ts";

const replySchema = z.object({ text: z.string() });

export async function transcribe(wav: Uint8Array, cred: TfdCredential): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }), "speech.wav");
  form.append("model", "breeze-asr-25");
  let response: Response;
  try {
    response = await fetch(`${cred.url}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${cred.key}` },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("TFD speech recognition timed out. Try again.");
    }
    throw new Error("Could not reach TFD speech recognition. Check your connection.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    // Remote error bodies can echo credentials or request text.
    throw new Error(`TFD speech recognition failed (HTTP ${response.status}). Try again later.`);
  }
  const parsed = replySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("TFD returned an invalid transcript. Try again later.");
  return parsed.data.text.trim();
}
