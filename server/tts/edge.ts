import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** The interpreter in the venv `uv tool install edge-tts` creates, the only one that can import edge_tts. */
export function edgePython(): string | null {
  const python =
    process.platform === "win32"
      ? join(homedir(), "AppData", "Roaming", "uv", "tools", "edge-tts", "Scripts", "python.exe")
      : join(homedir(), ".local", "share", "uv", "tools", "edge-tts", "bin", "python");
  return existsSync(python) ? python : null;
}

/** A PATH install cannot be probed cheaply, so a missing tool surfaces as an install hint when speaking. */
export function edgeAvailable(): boolean {
  return true;
}

export async function listVoices(): Promise<Voice[]> {
  return VOICES;
}

export interface WorkerChild {
  stdin: { write(line: string): unknown } | null;
  stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "exit" | "error", listener: () => void): unknown;
  kill(): unknown;
}

export type WorkerSpawn = () => WorkerChild | null;

interface Pending {
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
}

const WORKER_IDLE_MS = 5 * 60_000;
const WORKER_TIMEOUT_MS = 30_000;

/** Beside this module in a checkout; under tts/ beside the bundled server (scripts/bundle-server.mjs copies it). */
function workerScript(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "edge-worker.py"), join(here, "tts", "edge-worker.py")].find((path) => existsSync(path)) ?? null;
}

const spawnWorker: WorkerSpawn = () => {
  const python = edgePython();
  const script = workerScript();
  if (!python || !script) return null;
  return spawn(python, ["-I", script], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
};

/** A warm edge-tts process: importing the library once saves about a second per sentence over the CLI. */
export class EdgeWorker {
  private child: WorkerChild | null = null;
  private pending = new Map<string, Pending>();
  private buffer = "";
  private nextId = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private readonly spawnChild: WorkerSpawn;
  private readonly idleMs: number;
  private readonly timeoutMs: number;

  constructor(spawnChild: WorkerSpawn = spawnWorker, idleMs = WORKER_IDLE_MS, timeoutMs = WORKER_TIMEOUT_MS) {
    this.spawnChild = spawnChild;
    this.idleMs = idleMs;
    this.timeoutMs = timeoutMs;
  }

  synthesize(text: string, voice: string): Promise<Uint8Array> {
    const child = this.child ?? this.start();
    if (!child?.stdin) return Promise.reject(new Error("edge worker unavailable"));
    const id = String(this.nextId++);
    this.touch();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("edge worker timed out"));
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (bytes) => (clearTimeout(timer), resolve(bytes)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      try {
        child.stdin!.write(`${JSON.stringify({ id, text, voice })}\n`);
      } catch (error) {
        this.fail(error as Error);
      }
    });
  }

  close() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const child = this.child;
    this.child = null;
    this.buffer = "";
    this.fail(new Error("edge worker closed"));
    child?.kill();
  }

  private start(): WorkerChild | null {
    const child = this.spawnChild();
    if (!child) return null;
    this.child = child;
    child.stdout?.on("data", (chunk) => this.onData(chunk.toString()));
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      this.buffer = "";
      this.fail(new Error("edge worker exited"));
    };
    child.on("exit", gone);
    child.on("error", gone);
    return child;
  }

  private touch() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.idleMs);
    this.idle.unref?.();
  }

  private fail(error: Error) {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(error);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let reply: { id?: string; ok?: boolean; audio?: string };
      try {
        reply = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = reply.id === undefined ? undefined : this.pending.get(reply.id);
      if (!entry) continue;
      this.pending.delete(reply.id!);
      if (reply.ok && reply.audio) entry.resolve(new Uint8Array(Buffer.from(reply.audio, "base64")));
      else entry.reject(new Error("edge worker failed"));
    }
  }
}

let sharedWorker: EdgeWorker | null = null;
const defaultWorker = () => (sharedWorker ??= new EdgeWorker());

/**
 * edge-tts streams Microsoft Edge's read-aloud service and writes MP3; it stays a separate process (LGPL).
 * A warm worker is tried first; an injected `run` without a worker skips it so tests never spawn real processes.
 */
export async function synthesizeEdge(
  text: string,
  voiceId: string,
  run?: Runner,
  worker: EdgeWorker | null | undefined = run ? null : defaultWorker(),
): Promise<Audio> {
  const trimmed = text.trim();
  if (!trimmed) return { bytes: new Uint8Array(), mime: "audio/mpeg" };
  if (worker) {
    try {
      return { bytes: await worker.synthesize(trimmed, voiceId), mime: "audio/mpeg" };
    } catch {
      // fall through to the one-shot CLI
    }
  }
  const exec = run ?? defaultRun;
  const dir = await mkdtemp(join(tmpdir(), "openmausbot-edge-"));
  const out = join(dir, "utterance.mp3");
  try {
    await exec(edgeTtsPath(), ["--voice", voiceId, `--text=${trimmed}`, "--write-media", out], 30_000);
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
