// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CallChatDock } from "./CallChatDock";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const render = (active: boolean) =>
  flushSync(() => root.render(createElement(CallChatDock, { active, children: null }, createElement("p", { id: "kid" }, "chat"))));

describe("CallChatDock", () => {
  it("renders children with no panel or drag handle when not on a call", () => {
    render(false);
    expect(host.querySelector("#kid")).not.toBeNull();
    expect(host.querySelector("[data-call-chat-dock]")).toBeNull();
    expect(host.querySelector("[data-call-chat-handle]")).toBeNull();
  });

  it("floats the chat in a panel with a drag handle during a call", () => {
    render(true);
    const panel = host.querySelector<HTMLElement>("[data-call-chat-dock]");
    expect(panel?.querySelector("#kid")).not.toBeNull();
    expect(host.querySelector("[data-call-chat-handle]")).not.toBeNull();
  });

  it("moves the panel when the handle is dragged", () => {
    render(true);
    const panel = host.querySelector<HTMLElement>("[data-call-chat-dock]")!;
    const handle = host.querySelector<HTMLElement>("[data-call-chat-handle]")!;
    handle.setPointerCapture = () => {};
    const fire = (type: string, x: number, y: number) =>
      flushSync(() => {
        const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        handle.dispatchEvent(event);
      });
    fire("pointerdown", 100, 100);
    fire("pointermove", 60, 70);
    fire("pointerup", 60, 70);
    // Clamped to the parent (0x0 in happy-dom), so the panel pins to the top-left corner.
    expect(panel.style.left).toBe("0px");
    expect(panel.style.top).toBe("0px");
  });
});
