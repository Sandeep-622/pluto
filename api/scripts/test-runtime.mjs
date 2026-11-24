import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { stopChild } from "./process.mjs";
import { startLocalStorage } from "./storage.mjs";

export async function startTestHost() {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Test the Functions host with Node.js 24.");
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error("Port 7071 is in use. Stop that API before running tests.")));
    server.listen(7071, "127.0.0.1", () => server.close(resolve));
  });
  const api = fileURLToPath(new URL("..", import.meta.url));
  const folder = join(api, ".test-host");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "package.json"), JSON.stringify({ type: "module", main: "index.js" }));
  await writeFile(join(folder, "events.jsonl"), "");
  await copyFile(join(api, "host.json"), join(folder, "host.json"));
  await build({ entryPoints: [join(api, "..", "tests", "fixtures", "functions.ts")], outfile: join(folder, "index.js"), bundle: true, packages: "external", platform: "node", target: "node24", format: "esm" });
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PROCESSOR_ARCHITECTURE"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const storage = await startLocalStorage(join(folder, "storage"));
  Object.assign(env, { PATH: `${dirname(process.execPath)}${delimiter}${env.PATH}`, FUNCTIONS_WORKER_RUNTIME: "node", AzureWebJobsSecretStorageType: "files", AzureWebJobsStorage: storage.connectionString, FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT: "1", ALLOWED_ORIGINS: "http://localhost:3201,http://127.0.0.1:3201,http://127.0.0.1:3100" });
  const child = spawn(join(api, "node_modules", "azure-functions-core-tools", "bin", `func${process.platform === "win32" ? ".exe" : ""}`), ["start", "--port", "7071"], { cwd: folder, env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", (value) => { logs = (logs + value).slice(-12000); });
  child.stderr.on("data", (value) => { logs = (logs + value).slice(-12000); });
  let failure;
  child.on("error", (error) => { failure = error; });
  let stopping;
  const stop = () => stopping ??= Promise.all([stopChild(child), storage.stop()]);
  void storage.exited.then(() => { if (!stopping) { failure = new Error("Local test storage exited unexpectedly."); void stop().catch((error) => { console.error(error.message); process.exitCode = 1; }); } });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Functions host exited: ${logs}`);
      const response = await fetch("http://localhost:7071/api/health", { signal: AbortSignal.timeout(700) }).catch((error) => {
        if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
        return undefined;
      });
      if (response?.ok && response.headers.get("x-pluto-test-host") === "true") { ready = true; break; }
      await delay(500);
    }
    if (!ready) throw new Error(`Functions test host did not become ready: ${logs}`);
    console.log("Local Functions test host ready; external provider calls are blocked.");
    return { stop, events: async () => (await readFile(join(folder, "events.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).event), exited: new Promise((resolve) => child.once("exit", resolve)) };
  } catch (error) { await stop(); throw error; }
}
