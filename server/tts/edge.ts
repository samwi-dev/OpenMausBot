import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Audio, Voice } from "./elevenlabs.ts";
import type { Runner } from "./system-voices.ts";

const execFileAsync = promisify(execFile);

const defaultRun: Runner = (file, args, timeout) => execFileAsync(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 });

const VOICES: Voice[] = [
  { id: "zh-TW-HsiaoChenNeural", label: "HsiaoChen", description: "台灣 女" },
  { id: "zh-TW-HsiaoYuNeural", label: "HsiaoYu", description: "台灣 女" },
  { id: "zh-TW-YunJheNeural", label: "YunJhe", description: "台灣 男" },
  { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao", description: "中國 女" },
  { id: "zh-CN-YunxiNeural", label: "Yunxi", description: "中國 男" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava", description: "English, multilingual 女" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew", description: "English, multilingual 男" },
];

/** `uv tool install` puts the binary in ~/.local/bin, which a packaged macOS app's minimal PATH does not include. */
export function edgeTtsPath(): string {
  const home = join(homedir(), ".local", "bin", process.platform === "win32" ? "edge-tts.exe" : "edge-tts");
  return existsSync(home) ? home : "edge-tts";
}

/** A PATH install cannot be probed cheaply, so a missing tool surfaces as an install hint when speaking. */
export function edgeAvailable(): boolean {
  return true;
}

export async function listVoices(): Promise<Voice[]> {
  return VOICES;
}

/** edge-tts streams Microsoft Edge's read-aloud service and writes MP3; it stays a separate process (LGPL). */
export async function synthesizeEdge(text: string, voiceId: string, run: Runner = defaultRun): Promise<Audio> {
  const trimmed = text.trim();
  if (!trimmed) return { bytes: new Uint8Array(), mime: "audio/mpeg" };
  const dir = await mkdtemp(join(tmpdir(), "openmausbot-edge-"));
  const out = join(dir, "utterance.mp3");
  try {
    await run(edgeTtsPath(), ["--voice", voiceId, `--text=${trimmed}`, "--write-media", out], 30_000);
    return { bytes: new Uint8Array(await readFile(out)), mime: "audio/mpeg" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Edge voice needs the edge-tts tool. Install it with: uv tool install edge-tts");
    }
    throw new Error("Edge voice failed. Try again.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
