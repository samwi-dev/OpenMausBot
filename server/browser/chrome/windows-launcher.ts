// agent-browser's daemon runs detached with no console, so the cmd.exe it needs for a batch launcher opens a new console
// window (Windows Terminal, when it is the default terminal). This GUI-subsystem launcher runs the batch file's command
// line itself: it opens no console, hands Chrome its own standard handles, and waits for Chrome's exit code.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LAUNCHER_SOURCE = String.raw`using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

static class ChromeLauncher {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public int cb; public string reserved, desktop, title;
    public int x, y, width, height, columns, rows, fill, flags;
    public short show, reserved2; public IntPtr reserved3, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public int processId, threadId; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
    bool inheritHandles, int creationFlags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo info);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll")] static extern int WaitForSingleObject(IntPtr handle, int milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out int code);

  static string Arguments() {
    string line = Environment.CommandLine;
    int end = line.StartsWith("\"") ? line.IndexOf('"', 1) + 1 : line.IndexOf(' ');
    return end <= 0 || end >= line.Length ? "" : line.Substring(end).TrimStart(' ', '\t');
  }

  static int Main() {
    string script = Path.ChangeExtension(Assembly.GetEntryAssembly().Location, ".cmd");
    string template = "";
    foreach (string line in File.ReadAllLines(script)) if (line.Trim().Length > 0) template = line;
    int at = template.IndexOf("%*");
    if (at < 0) return 2;
    string command = template.Substring(0, at).Replace("%%", "%") + Arguments() + template.Substring(at + 2).Replace("%%", "%");
    StartupInfo startup = new StartupInfo();
    startup.cb = Marshal.SizeOf(typeof(StartupInfo));
    startup.flags = 0x100; // STARTF_USESTDHANDLES
    startup.input = GetStdHandle(-10);
    startup.output = GetStdHandle(-11);
    startup.error = GetStdHandle(-12);
    ProcessInfo info;
    if (!CreateProcess(null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x08000000, IntPtr.Zero, null, ref startup, out info)) {
      return Marshal.GetLastWin32Error();
    }
    WaitForSingleObject(info.process, -1);
    int code;
    GetExitCodeProcess(info.process, out code);
    return code;
  }
}
`;

/** .NET Framework 4.x, part of Windows 10 and 11. */
export function cscPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
}

type Compile = (csc: string, args: string[]) => Promise<void>;

const compile: Compile = (csc, args) => new Promise((resolve, reject) => {
  execFile(csc, args, { timeout: 60_000, windowsHide: true }, (error, stdout) => error ? reject(new Error(`csc failed: ${String(stdout).trim() || error.message}`)) : resolve());
});

/** Builds the launcher next to its batch file unless the same source already built it. */
export async function ensureWindowsLauncher(exe: string, run: Compile = compile, csc: string = cscPath()): Promise<void> {
  const source = exe.replace(/\.exe$/u, ".cs");
  if (existsSync(exe) && existsSync(source) && readFileSync(source, "utf8") === LAUNCHER_SOURCE) return;
  const temporary = `${exe}.${process.pid}.tmp.exe`;
  writeFileSync(source, LAUNCHER_SOURCE);
  try {
    await run(csc, ["/nologo", "/target:winexe", "/optimize+", `/out:${temporary}`, source]);
    renameSync(temporary, exe);
  } catch (error) {
    rmSync(temporary, { force: true });
    rmSync(source, { force: true });
    throw error;
  }
}
