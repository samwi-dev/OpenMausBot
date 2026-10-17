import type { AppConfig } from "./config.ts";

export interface TfdCredential {
  url: string;
  key: string;
}

/** The TFD engine is an ordinary `openai-compat` instance named `tfd`; voice reuses its URL and key. */
export function tfdCredential(cfg: AppConfig): TfdCredential | null {
  const entry = cfg.instances?.tfd;
  if (!entry || entry.driver !== "openai-compat") return null;
  const config = entry.config;
  if (!config || typeof config !== "object") return null;
  const { url, apiKeyEnv } = config as { url?: unknown; apiKeyEnv?: unknown };
  if (typeof url !== "string" || typeof apiKeyEnv !== "string" || !apiKeyEnv) return null;
  const base = url.trim().replace(/\/+$/, "");
  const key = entry.environment?.[apiKeyEnv];
  return base && key ? { url: base, key } : null;
}
