import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EdgeWorker, listVoices, synthesizeEdge, type WorkerChild } from "./edge.ts";
import type { Runner } from "./system-voices.ts";

const writer = (calls: string[][], bytes = [1, 2, 3]): Runner => async (_file, args) => {
  calls.push(args);
  await writeFile(args[args.indexOf("--write-media") + 1], Uint8Array.from(bytes));
  return { stdout: "" };
};

const edgeTemps = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("openmausbot-edge-"));

describe("Edge voices", () => {
  it("lists a fixed catalogue with the Taiwanese voice first", async () => {
    const voices = await listVoices();
    expect(voices[0].id).toBe("zh-TW-HsiaoChenNeural");
    expect(voices.every((v) => v.id && v.label)).toBe(true);
  });

  it("passes the voice and text as discrete args and returns the MP3 bytes", async () => {
    const calls: string[][] = [];
    const audio = await synthesizeEdge("hello", "zh-TW-HsiaoChenNeural", writer(calls));
    expect(audio.mime).toBe("audio/mpeg");
    expect([...audio.bytes]).toEqual([1, 2, 3]);
    expect(calls[0]).toEqual(expect.arrayContaining(["--voice", "zh-TW-HsiaoChenNeural", "--text=hello", "--write-media"]));
  });

  it("keeps text that starts with a dash inside --text=", async () => {
    const calls: string[][] = [];
    await synthesizeEdge("--rate=+90%", "v", writer(calls));
    expect(calls[0]).toContain("--text=--rate=+90%");
    expect(calls[0]).not.toContain("--rate=+90%");
  });

  it("returns empty audio for blank text without running the tool", async () => {
    const calls: string[][] = [];
    const audio = await synthesizeEdge("  ", "v", writer(calls));
    expect(audio.bytes.length).toBe(0);
    expect(calls).toEqual([]);
  });

  it("explains how to install the tool when it is missing", async () => {
    const run: Runner = async () => {
      throw Object.assign(new Error("spawn"), { code: "ENOENT" });
    };
    await expect(synthesizeEdge("hi", "v", run)).rejects.toThrow("uv tool install edge-tts");
  });

  it("hides other failures behind a generic message and removes the temp dir", async () => {
    const before = await edgeTemps();
    const run: Runner = async () => {
      throw new Error("secret stderr");
    };
    const error = await synthesizeEdge("hi", "v", run).catch((e: Error) => e);
    expect((error as Error).message).toBe("Edge voice failed. Try again.");
    expect(await edgeTemps()).toEqual(before);
  });
});

class FakeChild extends EventEmitter {
  written: { id: string; text: string; voice: string }[] = [];
  killed = false;
  stdout = new EventEmitter();
  stdin = { write: (line: string) => this.written.push(JSON.parse(line)) };
  kill() {
    this.killed = true;
    this.emit("exit");
  }
  reply(value: object) {
    this.stdout.emit("data", `${JSON.stringify(value)}\n`);
  }
}

const asChild = (child: FakeChild) => child as unknown as WorkerChild;
const b64 = (...bytes: number[]) => Buffer.from(bytes).toString("base64");

describe("Edge worker", () => {
  afterEach(() => vi.useRealTimers());

  it("sends newline JSON and resolves decoded audio, even when replies are split or out of order", async () => {
    const child = new FakeChild();
    const worker = new EdgeWorker(() => asChild(child));
    const a = worker.synthesize("one", "v1");
    const b = worker.synthesize("two", "v2");
    expect(child.written.map((w) => [w.text, w.voice])).toEqual([["one", "v1"], ["two", "v2"]]);
    const line = `${JSON.stringify({ id: child.written[1].id, ok: true, audio: b64(9, 8) })}\n`;
    child.stdout.emit("data", line.slice(0, 10));
    child.stdout.emit("data", line.slice(10));
    child.reply({ id: child.written[0].id, ok: true, audio: b64(1) });
    expect([...(await b)]).toEqual([9, 8]);
    expect([...(await a)]).toEqual([1]);
    worker.close();
  });

  it("rejects on ok:false and keeps serving later requests", async () => {
    const child = new FakeChild();
    const worker = new EdgeWorker(() => asChild(child));
    const bad = worker.synthesize("x", "v");
    child.reply({ id: child.written[0].id, ok: false });
    await expect(bad).rejects.toThrow();
    const good = worker.synthesize("y", "v");
    child.reply({ id: child.written[1].id, ok: true, audio: b64(5) });
    expect([...(await good)]).toEqual([5]);
    worker.close();
  });

  it("rejects pending requests when the process dies and respawns on the next call", async () => {
    const children: FakeChild[] = [];
    const worker = new EdgeWorker(() => {
      const child = new FakeChild();
      children.push(child);
      return asChild(child);
    });
    const lost = worker.synthesize("x", "v");
    children[0].emit("exit");
    await expect(lost).rejects.toThrow("exited");
    const again = worker.synthesize("y", "v");
    expect(children).toHaveLength(2);
    children[1].reply({ id: children[1].written[0].id, ok: true, audio: b64(7) });
    expect([...(await again)]).toEqual([7]);
    worker.close();
  });

  it("kills the process after the idle window and spawns a fresh one afterwards", async () => {
    vi.useFakeTimers();
    const children: FakeChild[] = [];
    const worker = new EdgeWorker(() => {
      const child = new FakeChild();
      children.push(child);
      return asChild(child);
    }, 1000);
    const first = worker.synthesize("x", "v");
    children[0].reply({ id: children[0].written[0].id, ok: true, audio: b64(1) });
    await first;
    vi.advanceTimersByTime(999);
    expect(children[0].killed).toBe(false);
    vi.advanceTimersByTime(2);
    expect(children[0].killed).toBe(true);
    void worker.synthesize("y", "v").catch(() => {});
    expect(children).toHaveLength(2);
    worker.close();
  });

  it("rejects when python or the script is missing", async () => {
    const worker = new EdgeWorker(() => null);
    await expect(worker.synthesize("x", "v")).rejects.toThrow("unavailable");
  });

  it("synthesizeEdge returns worker audio and skips the CLI", async () => {
    const child = new FakeChild();
    const worker = new EdgeWorker(() => asChild(child));
    const calls: string[][] = [];
    const pending = synthesizeEdge(" hi ", "v", writer(calls), worker);
    child.reply({ id: child.written[0].id, ok: true, audio: b64(4, 4) });
    expect([...(await pending).bytes]).toEqual([4, 4]);
    expect(child.written[0].text).toBe("hi");
    expect(calls).toEqual([]);
    worker.close();
  });

  it("synthesizeEdge falls back to the CLI when the worker fails", async () => {
    const child = new FakeChild();
    const worker = new EdgeWorker(() => asChild(child));
    const calls: string[][] = [];
    const pending = synthesizeEdge("hi", "v", writer(calls, [6]), worker);
    child.reply({ id: child.written[0].id, ok: false });
    expect([...(await pending).bytes]).toEqual([6]);
    expect(calls).toHaveLength(1);
    worker.close();
  });
});
