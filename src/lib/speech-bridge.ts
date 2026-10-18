// window.ogb comes from contextBridge and can't be patched, so call sites go through here. Windows and macOS
// record in the page and transcribe through the harness (TFD) instead of a native dictation helper.
import { createWebDictation } from "./web-dictation";

export type SpeechBridge = Pick<
  NonNullable<Window["ogb"]>,
  "speechStart" | "speechStop" | "speechFinish" | "onSpeechTranscript" | "onSpeechEnd"
>;

let web: ReturnType<typeof createWebDictation> | null = null;

export function speechBridge(): SpeechBridge | undefined {
  const ogb = globalThis.window?.ogb;
  if (ogb?.platform === "win32" || ogb?.platform === "darwin") return (web ??= createWebDictation());
  return ogb;
}
