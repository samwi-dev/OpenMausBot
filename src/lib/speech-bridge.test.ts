import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function bridgeFor(platform: string) {
  const ogb = { platform, speechStart: vi.fn() };
  vi.stubGlobal("window", { ogb });
  const { speechBridge } = await import("./speech-bridge");
  return { ogb, bridge: speechBridge() };
}

describe("speechBridge", () => {
  it.each(["win32", "darwin"])("records in the page on %s", async (platform) => {
    const { ogb, bridge } = await bridgeFor(platform);
    expect(bridge).not.toBe(ogb);
    expect(bridge?.speechStart).toBeTypeOf("function");
  });

  it("uses the native helper elsewhere", async () => {
    const { ogb, bridge } = await bridgeFor("linux");
    expect(bridge).toBe(ogb);
  });
});
