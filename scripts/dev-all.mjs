import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const listening = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });

async function ensure(script, port) {
  if (await listening(port)) return console.log(`${script}: already on ${port}`);
  const log = openSync(join(tmpdir(), `omb-${script.replace(":", "-")}.log`), "a");
  spawn("pnpm", [script], { cwd: root, detached: true, shell: true, stdio: ["ignore", log, log], windowsHide: true }).unref();
  for (let i = 0; i < 120 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await listening(port))) throw new Error(`${script} did not open ${port}; see ${join(tmpdir(), "omb-*.log")}`);
  console.log(`${script}: started on ${port}`);
}

await Promise.all([ensure("dev", 5199), ensure("dev:server", 8799)]);
const electron = createRequire(import.meta.url)("electron");
spawn(electron, [".", "--remote-debugging-port=9223"], { cwd: root, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
