import { describe, expect, it, vi } from "vitest";

import { createWebDictation, downsample, encodeWav, rmsDb } from "./web-dictation";

describe("rmsDb", () => {
  it("is -120 for silence and 0 for full scale", () => {
    expect(rmsDb(new Float32Array(100))).toBe(-120);
    expect(rmsDb(new Float32Array(100).fill(1))).toBeCloseTo(0, 5);
    expect(rmsDb(new Float32Array(100).fill(0.1))).toBeCloseTo(-20, 3);
  });
});

describe("downsample", () => {
  it("48k to 16k keeps a third of the samples", () => {
    const out = downsample(new Float32Array(4800).fill(0.5), 48_000, 16_000);
    expect(out.length).toBe(1600);
    expect(out[10]).toBeCloseTo(0.5);
  });

  it("returns the input when already at or below the target rate", () => {
    const input = new Float32Array(10);
    expect(downsample(input, 16_000, 16_000)).toBe(input);
  });
});

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header and clamped samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
    const view = new DataView(wav.buffer);
    const text = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(wav.length).toBe(44 + 8);
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(36)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(32767);
  });
});

const RATE = 16_000;
const FRAME = 4096;

function rig(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const track = { stop: vi.fn() };
  const contexts: Array<{ processor: { onaudioprocess: ((e: unknown) => void) | null }; close: ReturnType<typeof vi.fn> }> = [];
  class FakeCtx {
    sampleRate = RATE;
    destination = {};
    processor = { onaudioprocess: null as ((e: unknown) => void) | null, connect() {}, disconnect() {} };
    close = vi.fn();
    constructor() {
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      return this.processor;
    }
  }
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  const fetchMock = vi.fn(fetchImpl);
  const dictation = createWebDictation({
    getUserMedia,
    AudioContext: FakeCtx as never,
    fetch: fetchMock as never,
  });
  const events: Array<[string, unknown]> = [];
  dictation.onSpeechTranscript((line) => events.push(["transcript", line]));
  dictation.onSpeechEnd((info) => events.push(["end", info]));
  const push = (level: number, frames = 1, ctx = contexts[contexts.length - 1]) => {
    for (let i = 0; i < frames; i++) {
      ctx.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(FRAME).fill(level) } });
    }
  };
  return { dictation, track, contexts, getUserMedia, fetchMock, events, push };
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const flush = () => new Promise((r) => setTimeout(r, 0));
// 4096 / 16000 = 256ms per frame
const SPEECH = 0.2;
const QUIET = 0.0001;

describe("createWebDictation", () => {
  it("posts a WAV after speech then silence and emits final transcript then end", async () => {
    const r = rig(() => json({ text: " 你好 " }));
    await r.dictation.speechStart({ endpointMs: 1000 });
    expect(r.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    r.push(SPEECH, 3);
    r.push(QUIET, 5);
    await flush();
    expect(r.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = r.fetchMock.mock.calls[0];
    expect(url).toBe("/api/stt/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "audio/wav" });
    expect(String.fromCharCode(...(init.body as unknown as Uint8Array).slice(0, 4))).toBe("RIFF");
    expect(r.events).toEqual([
      ["transcript", { text: "你好", partial: false }],
      ["end", { code: 0 }],
    ]);
    expect(r.track.stop).toHaveBeenCalled();
  });

  it("restarts listening silently on an empty transcript", async () => {
    const r = rig(() => json({ text: "" }));
    await r.dictation.speechStart({ endpointMs: 1000 });
    r.push(SPEECH, 3);
    r.push(QUIET, 5);
    await flush();
    expect(r.events).toEqual([]);
    expect(r.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("reports an HTTP failure as an error transcript then stt-failed", async () => {
    const r = rig(() => json({ error: "TFD is not configured" }, 409));
    await r.dictation.speechStart({ endpointMs: 1000 });
    r.push(SPEECH, 3);
    r.push(QUIET, 5);
    await flush();
    expect(r.events).toEqual([
      ["transcript", { error: "TFD is not configured" }],
      ["end", { code: 1, reason: "stt-failed" }],
    ]);
  });

  it("reports a denied microphone", async () => {
    const r = rig(() => json({}));
    r.getUserMedia.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    await r.dictation.speechStart({ endpointMs: 1000 });
    expect(r.events).toEqual([["end", { code: 1, reason: "speech-not-authorized" }]]);
  });

  it("speechStop aborts capture without emitting anything", async () => {
    const r = rig(() => json({ text: "x" }));
    await r.dictation.speechStart({ endpointMs: 1000 });
    r.push(SPEECH, 3);
    await r.dictation.speechStop();
    r.push(QUIET, 10);
    await flush();
    expect(r.fetchMock).not.toHaveBeenCalled();
    expect(r.events).toEqual([]);
    expect(r.track.stop).toHaveBeenCalled();
  });

  it("speechFinish sends what was captured in manual mode", async () => {
    const r = rig(() => json({ text: "hello" }));
    await r.dictation.speechStart();
    r.push(SPEECH, 3);
    r.push(QUIET, 20);
    expect(r.fetchMock).not.toHaveBeenCalled();
    await r.dictation.speechFinish();
    await flush();
    expect(r.events).toEqual([
      ["transcript", { text: "hello", partial: false }],
      ["end", { code: 0 }],
    ]);
  });

  it("does not send pure silence", async () => {
    const r = rig(() => json({ text: "x" }));
    await r.dictation.speechStart();
    r.push(QUIET, 10);
    await r.dictation.speechFinish();
    await flush();
    expect(r.fetchMock).not.toHaveBeenCalled();
    expect(r.events).toEqual([["end", { code: 0 }]]);
  });
});
