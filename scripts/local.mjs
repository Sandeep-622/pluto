import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { stopChild } from "../api/scripts/process.mjs";

if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use Node.js 24 for the frontend and Functions host.");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const root = fileURLToPath(new URL("..", import.meta.url));
for (const port of [3201, 7071]) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use. Stop that preview before starting Pluto.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`, NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:7071" };
const frontend = process.argv[2] === "dev" ? ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3201"] : ["node_modules/serve/build/main.js", "out", "--listen", "tcp://127.0.0.1:3201", "--no-clipboard"];
const children = [spawn(process.execPath, frontend, { cwd: root, env, stdio: "inherit" }), spawn(process.execPath, ["scripts/start.mjs"], { cwd: fileURLToPath(new URL("../api", import.meta.url)), env, stdio: "inherit" })];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  void Promise.all(children.map(stopChild)).catch((error) => { console.error("Preview cleanup failed:", error.message); process.exitCode = 1; });
}
for (const child of children) {
  child.on("error", (error) => { console.error("Local startup failed:", error.message); stop(1); });
  child.on("exit", (code) => stop(code ?? 1));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
console.log("Pluto frontend: http://localhost:3201; Functions API: http://localhost:7071");
