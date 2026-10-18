import { describe, expect, it } from "vitest";
import { DELEGATE_MARKER, frontSplitter, hedgedVoiceFront, streamVoiceFront, voiceFrontPrompt, type FrontEvent } from "./voice-front.ts";

const bot = { name: "Mina", title: "Helper", description: "Likes tea." };

const sse = (...frames: string[]) => new Response(new ReadableStream({
  start(controller) {
    const enc = new TextEncoder();
    for (const frame of frames) controller.enqueue(enc.encode(frame));
    controller.close();
  },
}));
const chunk = (delta: object) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

function run(parts: string[]): FrontEvent[] {
  const splitter = frontSplitter();
  const out: FrontEvent[] = [];
  for (const part of parts) out.push(...splitter.push(part));
  out.push(...splitter.end());
  return out;
}

describe("voiceFrontPrompt", () => {
  it("puts persona and the delegate rule in the system message and keeps the last 8 messages", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, text: `m${i}` }));
    const [system, ...rest] = voiceFrontPrompt(bot, history);
    expect(system.role).toBe("system");
    expect(system.content).toContain("You are Mina");
    expect(system.content).toContain(DELEGATE_MARKER);
    expect(rest.map((m) => m.content)).toEqual(history.slice(4).map((m) => m.text));
    expect(rest[0].role).toBe("user");
  });
  it("truncates long messages", () => {
    const [, only] = voiceFrontPrompt(bot, [{ role: "user", text: "x".repeat(2000) }]);
    expect(only.content.length).toBe(600);
  });
});

describe("streamVoiceFront", () => {
  const base = { url: "https://x.test/v1", key: "k", model: "m", messages: [], signal: new AbortController().signal };
  it("emits content deltas only and ignores reasoning", async () => {
    const seen: string[] = [];
    const fetchImpl = async () => sse(chunk({ reasoning_content: "hmm" }), chunk({ content: "He" }), chunk({ content: "llo" }), "data: [DONE]\n\n");
    await streamVoiceFront({ ...base, onDelta: (t) => seen.push(t), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(seen).toEqual(["He", "llo"]);
  });
  it("handles frames split across reads", async () => {
    const seen: string[] = [];
    const whole = chunk({ content: "ok" });
    const fetchImpl = async () => sse(whole.slice(0, 15), whole.slice(15));
    await streamVoiceFront({ ...base, onDelta: (t) => seen.push(t), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(seen).toEqual(["ok"]);
  });
  it("throws on a non-200", async () => {
    const fetchImpl = async () => new Response("no", { status: 500 });
    await expect(streamVoiceFront({ ...base, onDelta: () => {}, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/500/);
  });
});

describe("frontSplitter", () => {
  it("passes a plain answer through as deltas", () => {
    expect(run(["你好", "，我很好。"])).toEqual([{ kind: "delta", text: "你好" }, { kind: "delta", text: "，我很好。" }]);
  });
  it("detects a marker split across deltas", () => {
    expect(run(["⟦", "查", "⟧我查", "一下。"])).toEqual([{ kind: "delegate", ack: "我查一下。" }]);
  });
  it("detects a whole marker in one delta", () => {
    expect(run(["⟦查⟧我查一下。"])).toEqual([{ kind: "delegate", ack: "我查一下。" }]);
  });
  it("releases text that merely starts like the marker", () => {
    expect(run(["⟦其他", "⟧"]).map((e) => e.kind === "delta" ? e.text : "").join("")).toBe("⟦其他⟧");
  });
  it("emits nothing for an empty reply", () => {
    expect(run([])).toEqual([]);
  });
  it("delegates with a default ack when the marker has none", () => {
    expect(run(["⟦查⟧"])).toEqual([{ kind: "delegate", ack: "我查一下。" }]);
  });
});

describe("hedgedVoiceFront", () => {
  const base = { url: "https://x.test/v1", key: "k", model: "m", messages: [], hedgeMs: 20, giveUpMs: 200 };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Each call takes the next delay; the reply text names which attempt answered.
  const fetchWith = (delays: number[]) => {
    let calls = 0;
    const fetchImpl = async (_url: string, init: { signal: AbortSignal }) => {
      const attempt = calls++;
      await wait(delays[attempt]);
      if (init.signal.aborted) throw new Error("aborted");
      return sse(chunk({ content: `attempt${attempt}` }));
    };
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: () => calls };
  };
  it("does not hedge when the first attempt answers in time", async () => {
    const seen: string[] = [];
    const f = fetchWith([0, 0]);
    await hedgedVoiceFront({ ...base, signal: new AbortController().signal, onDelta: (t) => seen.push(t), fetchImpl: f.fetchImpl });
    expect(seen).toEqual(["attempt0"]);
    expect(f.calls()).toBe(1);
  });
  it("takes the hedge when the first attempt is slow", async () => {
    const seen: string[] = [];
    const f = fetchWith([150, 0]);
    await hedgedVoiceFront({ ...base, signal: new AbortController().signal, onDelta: (t) => seen.push(t), fetchImpl: f.fetchImpl });
    expect(seen).toEqual(["attempt1"]);
    expect(f.calls()).toBe(2);
  });
  it("gives up when nobody speaks in time", async () => {
    const f = fetchWith([500, 500]);
    await expect(hedgedVoiceFront({ ...base, signal: new AbortController().signal, onDelta: () => {}, fetchImpl: f.fetchImpl })).rejects.toThrow(/first word/);
  });
  it("hedges at once when the first attempt fails", async () => {
    const seen: string[] = [];
    let calls = 0;
    const fetchImpl = (async () => (calls++ === 0 ? new Response("no", { status: 500 }) : sse(chunk({ content: "ok" })))) as unknown as typeof fetch;
    await hedgedVoiceFront({ ...base, hedgeMs: 10_000, signal: new AbortController().signal, onDelta: (t) => seen.push(t), fetchImpl });
    expect(seen).toEqual(["ok"]);
  });
});
