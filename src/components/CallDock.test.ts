// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CallDock } from "./CallDock";

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

const render = () =>
  flushSync(() => root.render(createElement(CallDock, { title: "Voice", children: null }, createElement("p", { id: "kid" }, "call"))));

describe("CallDock", () => {
  it("floats the call in a titled panel with a drag handle", () => {
    render();
    const panel = host.querySelector<HTMLElement>("[data-call-dock]");
    expect(panel?.querySelector("#kid")).not.toBeNull();
    expect(panel?.textContent).toContain("Voice");
    expect(host.querySelector("[data-call-dock-handle]")).not.toBeNull();
  });

  it("moves the panel when the handle is dragged", () => {
    render();
    const panel = host.querySelector<HTMLElement>("[data-call-dock]")!;
    const handle = host.querySelector<HTMLElement>("[data-call-dock-handle]")!;
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
