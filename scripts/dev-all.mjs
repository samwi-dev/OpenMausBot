import { execFileSync, spawn } from "node:child_process";
import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Node puts children that are not detached in a job that kills them when it exits, and a detached process has no
// console, so a console child it starts without windowsHide opens a new one. A detached holder starts each server
// with a hidden console and lives as long as it does.
if (process.argv[2] === "--hold") {
  spawn(process.argv[3], process.argv.slice(4), { cwd: root, stdio: "inherit", windowsHide: true }).on("exit", (code) => process.exit(code ?? 0));
} else {
  const logFile = (name) => openSync(join(tmpdir(), `omb-${name}.log`), "w");
  const pidFile = (name) => join(tmpdir(), `omb-${name}.pid`);
  if (process.argv.includes("--restart-server")) {
    try {
      execFileSync("taskkill", ["/PID", readFileSync(pidFile("dev-server"), "utf8").trim(), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      console.log("dev-server: no holder recorded by dev:all; stop it by hand if it still runs");
    }
    rmSync(pidFile("dev-server"), { force: true });
    await new Promise((r) => setTimeout(r, 1000));
  }
  const listening = (port) =>
    new Promise((resolve) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });

  async function ensure(name, args, port) {
    if (await listening(port)) return console.log(`${name}: already on ${port}`);
    const log = logFile(name);
    const holder = spawn(process.execPath, [fileURLToPath(import.meta.url), "--hold", process.execPath, ...args], { cwd: root, detached: true, stdio: ["ignore", log, log] });
    holder.unref();
    writeFileSync(pidFile(name), String(holder.pid));
    for (let i = 0; i < 120 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await listening(port))) throw new Error(`${name} did not open ${port}; see ${join(tmpdir(), `omb-${name}.log`)}`);
    console.log(`${name}: started on ${port}`);
  }

  await Promise.all([
    ensure("dev", [join(root, "node_modules", "vite", "bin", "vite.js")], 5199),
    ensure("dev-server", ["--experimental-strip-types", "server/dev-server.ts"], 8799),
  ]);
  if (!process.argv.includes("--restart-server")) {
    const electronLog = logFile("electron");
    const electron = createRequire(import.meta.url)("electron");
    spawn(electron, [".", "--remote-debugging-port=9223"], { cwd: root, detached: true, stdio: ["ignore", electronLog, electronLog] }).unref();
    console.log(`electron: started; log ${join(tmpdir(), "omb-electron.log")}`);
  }
}
