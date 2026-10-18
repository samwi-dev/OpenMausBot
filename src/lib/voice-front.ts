export type VoiceFrontResult = { kind: "answered" } | { kind: "delegate"; ack: string } | { kind: "fallback" };

/** Asks the harness's voice front desk; anything but a clean answer or delegate means "use the full bot". */
export async function askVoiceFront(
  botId: string,
  threadId: string,
  text: string,
  { onDelta, signal }: { onDelta: (text: string) => void; signal?: AbortSignal },
): Promise<VoiceFrontResult> {
  try {
    const response = await fetch(`/api/bots/${botId}/voice-front`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, text }),
      signal,
    });
    if (!response.ok || !response.body) return { kind: "fallback" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let ack: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!line.startsWith("data:")) continue;
        let frame: { event?: string; text?: string; ack?: string };
        try { frame = JSON.parse(line.slice(5)); } catch { continue; }
        if (frame.event === "delta" && frame.text) onDelta(frame.text);
        else if (frame.event === "delegate") ack = frame.ack ?? "";
        else if (frame.event === "error") return { kind: "fallback" };
        else if (frame.event === "done") return ack !== null ? { kind: "delegate", ack } : { kind: "answered" };
      }
    }
    return { kind: "fallback" };
  } catch {
    return { kind: "fallback" };
  }
}
