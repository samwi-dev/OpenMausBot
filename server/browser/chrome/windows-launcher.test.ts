import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import { ensureWindowsLauncher } from "./windows-launcher.ts";
import { batchQuote, launcherScriptPath } from "./wrapper.ts";

const folder = mkdtempSync(join(tmpdir(), "omb-windows-launcher-"));
afterAll(() => removeTempDir(folder));

describe("the windowless Windows launcher", () => {
  it("builds once per source", async () => {
    const exe = join(folder, "cached", "chrome-launcher.exe");
    const run = vi.fn(async (_csc: string, args: string[]) => {
      writeFileSync(args.find((arg) => arg.startsWith("/out:"))!.slice(5), "built");
    });
    mkdirSync(join(folder, "cached"));
    await ensureWindowsLauncher(exe, run, "csc.exe");
    await ensureWindowsLauncher(exe, run, "csc.exe");
    expect(run).toHaveBeenCalledOnce();
  });

  it.skipIf(process.platform !== "win32")("runs the batch command line with the caller's arguments and standard handles", async () => {
    const exe = join(folder, "chrome-launcher.exe");
    await ensureWindowsLauncher(exe);
    writeFileSync(launcherScriptPath(exe, "win32"), ["@echo off", `${batchQuote(process.execPath)} %* ${batchQuote("100%")} ${batchQuote("(KHTML, like Gecko)")}`, ""].join("\r\n"));
    const output = execFileSync(exe, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))"], { encoding: "utf8" });
    expect(JSON.parse(output)).toEqual(["100%", "(KHTML, like Gecko)"]);
  }, 60_000);
});
