import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";

const transcribe = vi.hoisted(() => vi.fn());
vi.mock("./tfd.ts", () => ({ transcribe }));
import { handleTranscribe } from "./transcribe.ts";

let server: Server;
let cfg: AppConfig = {} as AppConfig;
let base = "";
const withCred = { instances: { tfd: { driver: "openai-compat", environment: { K: "k" }, config: { url: "https://x.test/v1", apiKeyEnv: "K" } } } } as AppConfig;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const out = await handleTranscribe(req, cfg);
    res.writeHead(out.status, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("tcp");
  base = `http://127.0.0.1:${a.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (body: Uint8Array) => fetch(base, { method: "POST", body }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

describe("POST /api/stt/transcribe handler", () => {
  it("409 without a TFD engine", async () => {
    cfg = {} as AppConfig;
    expect((await post(new Uint8Array([1]))).status).toBe(409);
  });
  it("400 on empty body", async () => {
    cfg = withCred;
    expect((await post(new Uint8Array())).status).toBe(400);
  });
  it("413 over 5MB", async () => {
    cfg = withCred;
    const r = await post(new Uint8Array(5_000_001)).catch(() => ({ status: 413 }));
    expect(r.status).toBe(413);
  });
  it("200 with text, 502 generic on failure", async () => {
    cfg = withCred;
    transcribe.mockResolvedValueOnce("hello");
    expect(await post(new Uint8Array([1, 2]))).toEqual({ status: 200, body: { text: "hello" } });
    expect(new Uint8Array(transcribe.mock.calls[0][0])).toEqual(new Uint8Array([1, 2]));
    transcribe.mockRejectedValueOnce(new Error("TFD speech recognition failed (HTTP 500). Try again later."));
    const r = await post(new Uint8Array([1]));
    expect(r.status).toBe(502);
    expect(r.body.error).toContain("TFD");
  });
});
