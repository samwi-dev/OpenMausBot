// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { endpointMs, setEndpointMs, setSpeechRate, speechRate } from "./voice-tuning";

describe("voice tuning", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to 1.25x and 500 ms", () => {
    expect(speechRate()).toBe(1.25);
    expect(endpointMs()).toBe(500);
  });

  it("clamps to the supported range", () => {
    setSpeechRate(5);
    expect(speechRate()).toBe(2);
    setSpeechRate(0.1);
    expect(speechRate()).toBe(0.8);
    setEndpointMs(10);
    expect(endpointMs()).toBe(300);
    setEndpointMs(99999);
    expect(endpointMs()).toBe(1500);
  });

  it("persists across reads", () => {
    setSpeechRate(1.5);
    setEndpointMs(700);
    expect(localStorage.getItem("omb.voice.rate")).toBe("1.5");
    expect(localStorage.getItem("omb.voice.endpointMs")).toBe("700");
    expect(speechRate()).toBe(1.5);
    expect(endpointMs()).toBe(700);
  });

  it("falls back to defaults on garbage", () => {
    localStorage.setItem("omb.voice.rate", "fast");
    expect(speechRate()).toBe(1.25);
  });

  it("survives localStorage throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(speechRate()).toBe(1.25);
    expect(endpointMs()).toBe(500);
    expect(() => setSpeechRate(1.5)).not.toThrow();
  });
});
