import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as tfd from "./tfd.ts";
import * as stt from "../stt/tfd.ts";

let server: Server;
let cred: { url: string; key: string };
let status = 200;
let contentType = "audio/mpeg";
let sttReply: unknown = { text: "  你好  " };
const seen: Array<{ url: string; authorization?: string; ctype?: string; body: Buffer }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", authorization: req.headers.authorization, ctype: req.headers["content-type"], body: Buffer.concat(chunks) });
      if (status !== 200) {
        res.writeHead(status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "fixture-key private text" }));
      }
      if (req.url === "/v1/audio/transcriptions") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(sttReply));
      }
      res.writeHead(200, { "content-type": contentType });
      res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("tcp");
  cred = { url: `http://127.0.0.1:${a.port}/v1`, key: "fixture-key" };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { status = 200; contentType = "audio/mpeg"; sttReply = { text: "  你好  " }; seen.length = 0; });

describe("TFD TTS", () => {
  it("lists a fixed voice catalogue with serena first", async () => {
    const v = await tfd.listVoices();
    expect(v.map((x) => x.id)).toEqual(["serena", "vivian", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee"]);
  });
  it("posts speech request as mp3", async () => {
    const r = await tfd.synthesize("你好", "serena", cred);
    expect(r.mime).toBe("audio/mpeg");
    expect(seen[0]).toMatchObject({ url: "/v1/audio/speech", authorization: "Bearer fixture-key" });
    expect(JSON.parse(seen[0].body.toString("utf8"))).toEqual({ model: "qwen3-tts", input: "你好", voice: "serena", response_format: "mp3", language: "Chinese" });
  });
  it("sends Chinese as Simplified with the language set, and leaves other languages alone", async () => {
    await tfd.synthesize("記得帶傘，會議改到三點。", "serena", cred);
    await tfd.synthesize("See you at three.", "serena", cred);
    const [zh, en] = seen.slice(-2).map((request) => JSON.parse(request.body.toString("utf8")));
    expect(zh).toMatchObject({ input: "记得带伞，会议改到三点。", language: "Chinese" });
    expect(en.input).toBe("See you at three.");
    expect(en).not.toHaveProperty("language");
  });
  it("tolerates octet-stream but rejects other types", async () => {
    contentType = "application/octet-stream";
    expect((await tfd.synthesize("a", "serena", cred)).mime).toBe("audio/mpeg");
    contentType = "text/html";
    await expect(tfd.synthesize("a", "serena", cred)).rejects.toThrow("unexpected audio format");
  });
  it("never leaks the key or remote body in errors", async () => {
    status = 401;
    const err = (await tfd.synthesize("a", "serena", cred).then(() => null, (e: unknown) => e)) as Error;
    expect(err.message).not.toContain("fixture-key");
    expect(err.message).not.toContain("private text");
    expect(err.message).toContain("TFD");
  });
});

describe("TFD STT", () => {
  it("posts multipart wav and returns trimmed text", async () => {
    expect(await stt.transcribe(new Uint8Array([1, 2, 3]), cred)).toBe("你好");
    expect(seen[0]).toMatchObject({ url: "/v1/audio/transcriptions", authorization: "Bearer fixture-key" });
    expect(seen[0].ctype).toMatch(/^multipart\/form-data/);
    const raw = seen[0].body.toString("latin1");
    expect(raw).toContain('name="model"');
    expect(raw).toContain("breeze-asr-25");
    expect(raw).toContain('filename="speech.wav"');
  });
  it("fails generically on bad status or bad payload", async () => {
    sttReply = { nope: 1 };
    await expect(stt.transcribe(new Uint8Array([1]), cred)).rejects.toThrow("invalid transcript");
    status = 500;
    const err = (await stt.transcribe(new Uint8Array([1]), cred).then(() => null, (e: unknown) => e)) as Error;
    expect(err.message).not.toContain("private text");
    expect(err.message).not.toContain("fixture-key");
  });
});
