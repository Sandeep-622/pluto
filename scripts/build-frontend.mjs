import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { apiUrl } from "../src/lib/api.ts";
import { googleClientId } from "../src/lib/auth.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
apiUrl("health");
googleClientId();
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", resolve);
});
if (code !== 0) process.exit(code ?? 1);
await copyFile("staticwebapp.config.json", "out/staticwebapp.config.json");
