// Voice front desk: a lean prompt answers simple spoken turns, anything else is handed to the full bot.
import { liveInitialInput, type LiveHistoryMessage } from "./live-call.ts";
import { botPersona } from "./system-prompt.ts";

export const DELEGATE_MARKER = "⟦查⟧";
const MARKER_HEAD = DELEGATE_MARKER.slice(0, -1);
const DEFAULT_ACK = "我查一下。";

export interface FrontMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type FrontEvent = { kind: "delta"; text: string } | { kind: "delegate"; ack: string };

const RULES = [
  "This is a spoken phone call and your reply is read aloud.",
  "Reply in the user's language (Traditional Chinese when they speak Chinese), in a natural spoken style, one or two short sentences, the point first. No markdown, lists, links, code or emoji.",
  "You answer directly only: greetings, thanks, small talk, jokes, opinions, and repeating or summarising what was said earlier in this call (if asked to say it again, just repeat your last reply).",
  `Everything else goes to the full assistant, which has the tools, files, memory, settings and the internet. That includes: any fact about the world or the present (weather, news, time, prices, schedules, lookups), anything about files, memory or settings, which AI model or version you run on, and any request to do, open, change or check something, or to use the computer. Earlier replies in this chat may have been wrong or out of date: never reuse them for such questions.`,
  `For those, reply with exactly ${DELEGATE_MARKER} followed by one short spoken acknowledgement and nothing else. Never guess, never say you cannot do it.`,
  "Examples:",
  `User: 今天天氣如何 -> ${DELEGATE_MARKER}我查一下。`,
  `User: 幫我查明天行程 -> ${DELEGATE_MARKER}好，我來看看。`,
  `User: 你用什麼模型 -> ${DELEGATE_MARKER}我確認一下。`,
  `User: 打開瀏覽器 -> ${DELEGATE_MARKER}好，我來開。`,
  `User: 我的記憶裡有什麼 -> ${DELEGATE_MARKER}我翻一下。`,
  "User: 你好嗎 -> 我很好，你呢？",
  "User: 謝謝 -> 不客氣。",
  "User: 好，那就這樣 -> 好，再聊。",
].join("\n");

export function voiceFrontPrompt(
  bot: { name: string; title?: string; description?: string },
  history: LiveHistoryMessage[],
): FrontMessage[] {
  const turns = liveInitialInput(history).map((item) => ({
    role: item.role,
    content: item.content[0].text,
  }));
  return [{ role: "system", content: `${botPersona(bot).slice(0, 400)}\n\n${RULES}` }, ...turns];
}

export interface StreamVoiceFrontOptions {
  url: string;
  key: string;
  model: string;
  messages: FrontMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
  fetchImpl?: typeof fetch;
}

/** Streams `delta.content` only; reasoning is ignored. */
export async function streamVoiceFront(options: StreamVoiceFrontOptions): Promise<void> {
  const { url, key, model, messages, signal, onDelta, fetchImpl = fetch } = options;
  const response = await fetchImpl(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`voice front model returned ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: { choices?: { index?: number; delta?: { content?: unknown } }[] };
    try { chunk = JSON.parse(data); } catch { return; }
    const content = chunk.choices?.find((row) => row.index === undefined || row.index === 0)?.delta?.content;
    if (typeof content === "string" && content) onDelta(content);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      consume(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
    }
  }
  consume((buffer + decoder.decode()).trim());
}

/** Holds back text only while it could still turn out to be the marker, which may arrive split across deltas. */
export function frontSplitter() {
  let pending = "";
  let mode: "undecided" | "text" | "delegate" = "undecided";
  let ack = "";
  return {
    push(text: string): FrontEvent[] {
      if (mode === "text") return text ? [{ kind: "delta", text }] : [];
      if (mode === "delegate") { ack += text; return []; }
      pending += text;
      const head = pending.trimStart();
      if (!head) return [];
      // The model sometimes drops the closing bracket.
      if (head.startsWith(MARKER_HEAD)) {
        mode = "delegate";
        ack = head.slice(MARKER_HEAD.length);
        pending = "";
        return [];
      }
      if (MARKER_HEAD.startsWith(head)) return [];
      mode = "text";
      const out = head;
      pending = "";
      return [{ kind: "delta", text: out }];
    },
    end(): FrontEvent[] {
      if (mode === "delegate") return [{ kind: "delegate", ack: ack.replace(/^⟧/, "").trim() || DEFAULT_ACK }];
      const rest = pending;
      pending = "";
      return rest.trim() ? [{ kind: "delta", text: rest }] : [];
    },
  };
}
