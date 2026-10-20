import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const logFile = (name) => openSync(join(tmpdir(), `omb-${name}.log`), "w");
const listening = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });

async function ensure(name, command, port) {
  if (await listening(port)) return console.log(`${name}: already on ${port}`);
  const log = logFile(name);
  spawn(command, { cwd: root, detached: true, shell: true, stdio: ["ignore", log, log], windowsHide: true }).unref();
  for (let i = 0; i < 120 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await listening(port))) throw new Error(`${name} did not open ${port}; see ${join(tmpdir(), `omb-${name}.log`)}`);
  console.log(`${name}: started on ${port}`);
}

await Promise.all([
  ensure("dev", "pnpm dev", 5199),
  ensure("dev-server", "node --watch --experimental-strip-types server/dev-server.ts", 8799),
]);
const electronLog = logFile("electron");
const electron = createRequire(import.meta.url)("electron");
spawn(electron, [".", "--remote-debugging-port=9223"], { cwd: root, detached: true, stdio: ["ignore", electronLog, electronLog] }).unref();
console.log(`electron: started; log ${join(tmpdir(), "omb-electron.log")}`);
