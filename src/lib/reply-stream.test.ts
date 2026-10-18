import { describe, expect, it } from "vitest";
import { emitReplyDelta, onReplyDelta } from "./reply-stream";

describe("reply-stream", () => {
  it("delivers only to listeners of the same thread", () => {
    const a: string[] = [];
    const b: string[] = [];
    const offA = onReplyDelta("t1", (d) => a.push(d));
    const offB = onReplyDelta("t2", (d) => b.push(d));
    emitReplyDelta("t1", "hi");
    emitReplyDelta("t2", "yo");
    expect(a).toEqual(["hi"]);
    expect(b).toEqual(["yo"]);
    offA();
    offB();
  });
  it("stops after unsubscribe and tolerates emits with no listeners", () => {
    const got: string[] = [];
    const off = onReplyDelta("t3", (d) => got.push(d));
    emitReplyDelta("t3", "a");
    off();
    emitReplyDelta("t3", "b");
    expect(got).toEqual(["a"]);
  });
});
