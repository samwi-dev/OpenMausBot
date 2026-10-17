// RMS-threshold end-of-turn detector: no VAD model, just "spoke, then went quiet for endpointMs".
export type EndpointState = "waiting" | "speaking" | "done";

const ONSET_MS = 150;

export function createEndpointer({
  thresholdDb = -45,
  endpointMs,
  maxMs = 60_000,
}: {
  thresholdDb?: number;
  endpointMs: number;
  maxMs?: number;
}) {
  let elapsed = 0;
  let loud = 0;
  let quiet = 0;
  let speaking = false;
  return {
    push(rmsDb: number, frameMs: number): EndpointState {
      elapsed += frameMs;
      if (rmsDb >= thresholdDb) {
        loud += frameMs;
        quiet = 0;
        if (loud >= ONSET_MS) speaking = true;
      } else {
        if (!speaking) loud = 0;
        else quiet += frameMs;
      }
      if (elapsed >= maxMs) return "done";
      if (speaking && quiet >= endpointMs) return "done";
      return speaking ? "speaking" : "waiting";
    },
  };
}
