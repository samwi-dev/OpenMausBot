// window.ogb comes from contextBridge and can't be patched, so call sites go through here. Windows has no native
// dictation helper; it records in the page and transcribes through the harness instead.
import { createWebDictation } from "./web-dictation";

export type SpeechBridge = Pick<
  NonNullable<Window["ogb"]>,
  "speechStart" | "speechStop" | "speechFinish" | "onSpeechTranscript" | "onSpeechEnd"
>;

let web: ReturnType<typeof createWebDictation> | null = null;

export function speechBridge(): SpeechBridge | undefined {
  const ogb = globalThis.window?.ogb;
  if (ogb?.platform === "win32") return (web ??= createWebDictation());
  return ogb;
}
