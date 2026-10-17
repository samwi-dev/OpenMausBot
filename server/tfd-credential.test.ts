import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import { tfdCredential } from "./tfd-credential.ts";

const tfd = (over: Record<string, unknown> = {}, driver = "openai-compat"): AppConfig => ({
  instances: { tfd: { driver, environment: { TFD_API_KEY: "k" }, config: { url: "https://x.test/v1//", apiKeyEnv: "TFD_API_KEY", ...over } } },
} as AppConfig);

describe("tfdCredential", () => {
  it("reads url and key from the tfd instance", () => {
    expect(tfdCredential(tfd())).toEqual({ url: "https://x.test/v1", key: "k" });
  });
  it("returns null when anything is missing or the driver differs", () => {
    expect(tfdCredential({} as AppConfig)).toBeNull();
    expect(tfdCredential(tfd({ url: "" }))).toBeNull();
    expect(tfdCredential(tfd({ apiKeyEnv: "OTHER" }))).toBeNull();
    expect(tfdCredential(tfd({}, "grok"))).toBeNull();
  });
});
