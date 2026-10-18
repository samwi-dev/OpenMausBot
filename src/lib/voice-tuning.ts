import { useSyncExternalStore } from "react";

const RATE_KEY = "omb.voice.rate";
const ENDPOINT_KEY = "omb.voice.endpointMs";
const COMMAND_KEY = "omb.voice.commandMode";

export const SPEECH_RATE = { min: 0.8, max: 2, step: 0.05, fallback: 1.25 } as const;
export const ENDPOINT_MS = { min: 300, max: 1500, step: 50, fallback: 500 } as const;

type Range = { min: number; max: number; fallback: number };

function read(key: string, range: Range): number {
  try {
    const value = Number(localStorage.getItem(key));
    if (!Number.isFinite(value) || value === 0) return range.fallback;
    return Math.min(range.max, Math.max(range.min, value));
  } catch {
    return range.fallback;
  }
}

const listeners = new Set<() => void>();

function write(key: string, range: Range, value: number): void {
  const next = Math.min(range.max, Math.max(range.min, value));
  try {
    localStorage.setItem(key, String(next));
  } catch {
    // The setting just isn't remembered.
  }
  for (const listener of listeners) listener();
}

export const speechRate = () => read(RATE_KEY, SPEECH_RATE);
export const endpointMs = () => read(ENDPOINT_KEY, ENDPOINT_MS);
export const setSpeechRate = (value: number) => write(RATE_KEY, SPEECH_RATE, value);
export const setEndpointMs = (value: number) => write(ENDPOINT_KEY, ENDPOINT_MS, value);

export function commandMode(): boolean {
  try {
    return localStorage.getItem(COMMAND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCommandMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(COMMAND_KEY, "1");
    else localStorage.removeItem(COMMAND_KEY);
  } catch {
    // The setting just isn't remembered.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceTuning(): { speechRate: number; endpointMs: number; commandMode: boolean } {
  const rate = useSyncExternalStore(subscribe, speechRate, speechRate);
  const endpoint = useSyncExternalStore(subscribe, endpointMs, endpointMs);
  const command = useSyncExternalStore(subscribe, commandMode, commandMode);
  return { speechRate: rate, endpointMs: endpoint, commandMode: command };
}
