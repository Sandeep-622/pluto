import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, delimiter } from "node:path";
import { stopChild } from "./process.mjs";
import { startLocalStorage } from "./storage.mjs";

if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use Node.js 24 to run the Windows Functions host.");
if (existsSync(".env")) process.loadEnvFile(".env");
const command = fileURLToPath(new URL("../node_modules/azure-functions-core-tools/bin/func", import.meta.url)) + (process.platform === "win32" ? ".exe" : "");
if (!existsSync(command)) throw new Error("Functions Core Tools is missing. Run npm --prefix api ci first.");
const storage = await startLocalStorage(fileURLToPath(new URL("../.local-storage", import.meta.url)));
const child = spawn(command, ["start", "--port", "7071"], {
  stdio: "inherit",
  env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`, FUNCTIONS_WORKER_RUNTIME: "node", AzureWebJobsSecretStorageType: "files", AzureWebJobsStorage: storage.connectionString, FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT: "1", ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "http://localhost:3201,http://127.0.0.1:3201" }
});
let stopping;
function stop(code) {
  if (stopping) return stopping;
  process.exitCode = code;
  stopping = Promise.all([stopChild(child), storage.stop()]).catch((error) => { console.error("Functions cleanup failed:", error.message); process.exitCode = 1; });
  return stopping;
}
child.on("error", (error) => { console.error("Functions startup failed:", error.message); void stop(1); });
child.on("exit", (code) => { void stop(code ?? 1); });
void storage.exited.then(() => { if (!stopping) { console.error("Local storage exited unexpectedly."); void stop(1); } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void stop(0); });
