import { describe, expect, it } from "vitest";

import { createEndpointer } from "./endpointer";

const LOUD = -20;
const QUIET = -70;

function feed(ep: ReturnType<typeof createEndpointer>, db: number, ms: number, frame = 50) {
  let last: ReturnType<typeof ep.push> = "waiting";
  for (let t = 0; t < ms; t += frame) last = ep.push(db, frame);
  return last;
}

describe("createEndpointer", () => {
  it("stays waiting through pure silence", () => {
    const ep = createEndpointer({ endpointMs: 1000 });
    expect(feed(ep, QUIET, 20_000)).toBe("waiting");
  });

  it("ignores a click shorter than the speech onset", () => {
    const ep = createEndpointer({ endpointMs: 500 });
    expect(ep.push(LOUD, 50)).toBe("waiting");
    expect(feed(ep, QUIET, 5000)).toBe("waiting");
  });

  it("enters speaking after sustained loudness", () => {
    const ep = createEndpointer({ endpointMs: 1000 });
    expect(feed(ep, LOUD, 300)).toBe("speaking");
  });

  it("finishes after endpointMs of silence following speech", () => {
    const ep = createEndpointer({ endpointMs: 1000 });
    feed(ep, LOUD, 500);
    expect(feed(ep, QUIET, 900)).toBe("speaking");
    expect(feed(ep, QUIET, 150)).toBe("done");
  });

  it("resets the silence run when speech resumes", () => {
    const ep = createEndpointer({ endpointMs: 1000 });
    feed(ep, LOUD, 500);
    feed(ep, QUIET, 800);
    feed(ep, LOUD, 100);
    expect(feed(ep, QUIET, 800)).toBe("speaking");
    expect(feed(ep, QUIET, 250)).toBe("done");
  });

  it("finishes at maxMs even without speech", () => {
    const ep = createEndpointer({ endpointMs: 1000, maxMs: 2000 });
    expect(feed(ep, QUIET, 1900)).toBe("waiting");
    expect(feed(ep, QUIET, 200)).toBe("done");
  });

  it("honors a custom threshold", () => {
    const ep = createEndpointer({ endpointMs: 500, thresholdDb: -30 });
    expect(feed(ep, -40, 1000)).toBe("waiting");
    expect(feed(ep, -20, 300)).toBe("speaking");
  });
});
