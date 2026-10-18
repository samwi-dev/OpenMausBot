import type { AppConfig } from "./config.ts";

export interface TfdCredential {
  url: string;
  key: string;
}

/** URL and key of any `openai-compat` instance. */
export function instanceCredential(cfg: AppConfig, instanceId: string): TfdCredential | null {
  const entry = cfg.instances?.[instanceId];
  if (!entry || entry.driver !== "openai-compat") return null;
  const config = entry.config;
  if (!config || typeof config !== "object") return null;
  const { url, apiKeyEnv, key: inlineKey } = config as { url?: unknown; apiKeyEnv?: unknown; key?: unknown };
  if (typeof url !== "string") return null;
  const base = url.trim().replace(/\/+$/, "");
  const key = typeof inlineKey === "string" && inlineKey ? inlineKey
    : typeof apiKeyEnv === "string" && apiKeyEnv ? entry.environment?.[apiKeyEnv] : undefined;
  return base && key ? { url: base, key } : null;
}

/** The TFD engine is an ordinary `openai-compat` instance named `tfd`; voice reuses its URL and key. */
export function tfdCredential(cfg: AppConfig): TfdCredential | null {
  return instanceCredential(cfg, "tfd");
}
