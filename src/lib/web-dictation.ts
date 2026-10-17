// Windows stand-in for the native dictation bridge: record the mic, cut the turn on silence, send the WAV to the
// harness (/api/stt/transcribe), and replay the same transcript/end events the macOS helper emits.
import { createEndpointer } from "./endpointer";

const TARGET_RATE = 16_000;
const BUFFER_SIZE = 4096;

export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -120;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

/** Linear-interpolation resample; fine for speech going to an ASR model. */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

type Track = { stop(): void };
type Stream = { getTracks(): Track[] };
type AudioNode = { connect(to?: unknown): void; disconnect(): void };
type Processor = AudioNode & {
  onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null;
};
type AudioCtx = {
  sampleRate: number;
  destination: unknown;
  createMediaStreamSource(stream: Stream): AudioNode;
  createScriptProcessor(size: number, inputs: number, outputs: number): Processor;
  close(): Promise<void> | void;
};

export type WebDictationDeps = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<Stream>;
  AudioContext?: new () => AudioCtx;
  fetch?: typeof fetch;
};

type Line = { partial?: boolean; text?: string; error?: string };
type End = { code: number | null; reason?: string };
type Options = { endpointMs?: number };

export function createWebDictation(deps: WebDictationDeps = {}) {
  const transcriptListeners = new Set<(line: Line) => void>();
  const endListeners = new Set<(info: End) => void>();
  let generation = 0;
  let teardown: (() => void) | null = null;
  let finishNow: (() => void) | null = null;
  let inflight: AbortController | null = null;

  const emitTranscript = (line: Line) => transcriptListeners.forEach((cb) => cb(line));
  const emitEnd = (info: End) => endListeners.forEach((cb) => cb(info));

  const abort = () => {
    generation += 1;
    finishNow = null;
    inflight?.abort();
    inflight = null;
    teardown?.();
    teardown = null;
  };

  async function listen(options: Options | undefined, mine: number): Promise<void> {
    const getUserMedia =
      deps.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
    const Ctor = deps.AudioContext ?? (globalThis.AudioContext as unknown as new () => AudioCtx);
    const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

    let stream: Stream;
    try {
      stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      if (mine !== generation) return;
      const name = (error as { name?: string } | null)?.name;
      emitEnd({
        code: 1,
        reason: name === "NotAllowedError" || name === "SecurityError" ? "speech-not-authorized" : "mic-unavailable",
      });
      return;
    }
    if (mine !== generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    // Manual capture (composer / push-to-talk) passes no endpointMs: only speechFinish or maxMs ends the turn.
    const endpointer = createEndpointer({ endpointMs: options?.endpointMs ?? Number.POSITIVE_INFINITY });
    const chunks: Float32Array[] = [];
    let spoke = false;
    let finished = false;

    const release = () => {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
        source.disconnect();
      } catch {
        // already disconnected
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    };
    teardown = release;

    const finish = async () => {
      if (finished) return;
      finished = true;
      finishNow = null;
      release();
      teardown = null;

      // Silence (or an empty transcript) in call mode just listens again; manual capture ends the turn.
      const restartOrEnd = () => {
        if (mine !== generation) return;
        if (options?.endpointMs !== undefined) void listen(options, mine);
        else emitEnd({ code: 0 });
      };
      if (!spoke) return restartOrEnd();

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        merged.set(c, at);
        at += c.length;
      }
      const wav = encodeWav(downsample(merged, ctx.sampleRate), Math.min(ctx.sampleRate, TARGET_RATE));

      const controller = new AbortController();
      inflight = controller;
      try {
        const res = await doFetch("/api/stt/transcribe", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: wav as unknown as BodyInit,
          signal: controller.signal,
        });
        const body: { text?: string; error?: string } = await res.json().catch(() => ({}));
        if (mine !== generation) return;
        inflight = null;
        if (!res.ok) {
          emitTranscript({ error: body.error ?? `the speech service returned ${res.status}` });
          emitEnd({ code: 1, reason: "stt-failed" });
          return;
        }
        const text = (body.text ?? "").trim();
        if (!text) return restartOrEnd();
        // CallView only acts on partial === false.
        emitTranscript({ text, partial: false });
        emitEnd({ code: 0 });
      } catch (error) {
        if (mine !== generation) return;
        inflight = null;
        emitTranscript({ error: error instanceof Error ? error.message : "speech request failed" });
        emitEnd({ code: 1, reason: "stt-failed" });
      }
    };
    finishNow = () => void finish();

    processor.onaudioprocess = (event) => {
      if (finished) return;
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(data);
      const frameMs = (data.length / ctx.sampleRate) * 1000;
      const state = endpointer.push(rmsDb(data), frameMs);
      if (state === "speaking") spoke = true;
      if (state === "done") void finish();
    };
    source.connect(processor);
    processor.connect(ctx.destination);
  }

  return {
    async speechStart(options?: Options): Promise<void> {
      abort();
      await listen(options, generation);
    },
    // Intentional stop emits no end: CallView re-listens on any code-0 end while "listening".
    async speechStop(): Promise<void> {
      abort();
    },
    async speechFinish(): Promise<void> {
      finishNow?.();
    },
    onSpeechTranscript(cb: (line: Line) => void): () => void {
      transcriptListeners.add(cb);
      return () => transcriptListeners.delete(cb);
    },
    onSpeechEnd(cb: (info: End) => void): () => void {
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },
  };
}
