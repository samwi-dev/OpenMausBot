import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { listVoices, synthesizeEdge } from "./edge.ts";
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
