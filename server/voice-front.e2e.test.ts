import { createServer } from "node:http";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { fixtureApi } from "../scripts/testing/preview-fixture.ts";

const content = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

it("voice-front answers directly into the thread, delegates without writing, and refuses a non openai-compat bot", async () => {
  const provider = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "fixture-model" }] })); return; }
      const last = JSON.parse(raw || "{}").messages?.at(-1)?.content ?? "";
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(last.includes("weather")
        ? `${content("⟦")}${content("查⟧我查")}${content("一下。")}data: [DONE]\n\n`
        : `${content("Fine,")}${content(" thanks.")}data: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("fixture provider has no port");
  const fixture = await launchVerificationServer();
  const api = fixtureApi(fixture.info.url);
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const front = async (botId: string, threadId: string, text: string) => {
    const response = await fetch(`${fixture.info.url}/api/bots/${botId}/voice-front`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, text }),
    });
    const body = await response.text();
    const events = response.headers.get("content-type")?.includes("event-stream")
      ? body.split("\n\n").filter(Boolean).map((frame) => JSON.parse(frame.slice(5)))
      : [];
    return { status: response.status, events };
  };
  try {
    const { instanceId } = await api("POST", "/api/instances/openai-compat", {
      displayName: "Front fixture", url: `http://127.0.0.1:${address.port}/v1`, key: "fixture-key", models: ["fixture-model"],
    });
    const { bot } = await control(["new-bot", "--name", "Front fixture"]);
    const rows = async () => (await control(["messages", "--bot", bot.id, "--limit", "20"]));
    const threadId = (await rows()).bot.tasks[0].taskId as string;

    expect((await front(bot.id, threadId, "hello")).status).toBe(409);

    await control(["set-model", "--bot", bot.id, "--instance", instanceId, "--model", "fixture-model"]);
    const before = JSON.stringify(await rows());

    const delegated = await front(bot.id, threadId, "what is the weather");
    expect(delegated.events).toEqual([{ event: "delegate", ack: "我查一下。" }, { event: "done" }]);
    expect(JSON.stringify(await rows())).toBe(before);

    const direct = await front(bot.id, threadId, "how are you");
    expect(direct.events.map((e) => e.event)).toEqual(["delta", "delta", "done"]);
    const after = JSON.stringify(await rows());
    expect(after).toContain("how are you");
    expect(after).toContain("Fine, thanks.");
    const snapshot = await api("GET", "/api/bots?messages=20");
    const spoken = snapshot.bots.find((b: { id: string }) => b.id === bot.id).messages.find((m: { text?: string }) => m.text === "how are you");
    expect(spoken.via).toBe("call");

    expect((await front(bot.id, "no-such-thread", "hello")).status).toBe(409);
  } finally {
    await fixture.close();
    provider.close();
  }
}, 60_000);
