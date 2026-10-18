import { afterEach, describe, expect, it, vi } from "vitest";
import { askVoiceFront } from "./voice-front";

const sse = (...events: object[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
  status: 200, headers: { "content-type": "text/event-stream" },
});

afterEach(() => vi.unstubAllGlobals());

describe("askVoiceFront", () => {
  it("streams deltas and resolves answered", async () => {
    const fetchMock = vi.fn(async () => sse({ event: "delta", text: "你好" }, { event: "delta", text: "。" }, { event: "done" }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const result = await askVoiceFront("b1", "t1", "嗨", { onDelta: (t) => seen.push(t), signal: new AbortController().signal });
    expect(result).toEqual({ kind: "answered" });
    expect(seen).toEqual(["你好", "。"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/bots/b1/voice-front", expect.objectContaining({ method: "POST", body: JSON.stringify({ threadId: "t1", text: "嗨" }) }));
  });
  it("resolves delegate with the ack", async () => {
    vi.stubGlobal("fetch", async () => sse({ event: "delegate", ack: "我查一下。" }, { event: "done" }));
    expect(await askVoiceFront("b", "t", "天氣", { onDelta: () => {} })).toEqual({ kind: "delegate", ack: "我查一下。" });
  });
  it("falls back on a non-200", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 409 }));
    expect(await askVoiceFront("b", "t", "x", { onDelta: () => {} })).toEqual({ kind: "fallback" });
  });
  it("falls back on a network error", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    expect(await askVoiceFront("b", "t", "x", { onDelta: () => {} })).toEqual({ kind: "fallback" });
  });
  it("falls back on an error event", async () => {
    vi.stubGlobal("fetch", async () => sse({ event: "error", error: "no first word in time" }));
    expect(await askVoiceFront("b", "t", "x", { onDelta: () => {} })).toEqual({ kind: "fallback" });
  });
  it("falls back when the stream ends without done", async () => {
    vi.stubGlobal("fetch", async () => sse({ event: "delta", text: "半" }));
    expect(await askVoiceFront("b", "t", "x", { onDelta: () => {} })).toEqual({ kind: "fallback" });
  });
});
