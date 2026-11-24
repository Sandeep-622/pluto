import { spawn } from "node:child_process";

export async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    const command = `$all = @(Get-CimInstance Win32_Process); $ids = @(${child.pid}); do { $next = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | Select-Object -ExpandProperty ProcessId); $ids += $next } while ($next.Count -gt 0); $children = @(Get-Process -Id $ids -ErrorAction SilentlyContinue); foreach ($process in $children) { try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch { if (!$process.HasExited) { throw } } }; foreach ($process in $children) { if (!$process.WaitForExit(10000)) { throw 'Child process cleanup timed out.' } }`;
    await new Promise((resolve, reject) => {
      const cleanup = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "inherit" });
      cleanup.on("error", reject);
      cleanup.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Could not stop the local child process tree.")));
    });
  } else { child.kill("SIGTERM"); }
  await ended;
}
