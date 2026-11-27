import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const values = (await readFile("api/.env", "utf8").catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return "";
})).split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match || !/(?:KEY|TOKEN|PASSWORD|SECRET|CONNECTION_STRING)$/i.test(match[1])) return [];
  const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
  return value.length >= 16 ? [value] : [];
});
async function files(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}
const publicFiles = await files("out");
const backendFiles = await files("api/dist");
const gitFiles = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const all = [...new Set([...publicFiles, ...backendFiles, ...gitFiles])];
for (const path of all) {
  if (/(^|[\\/])\.env(?:$|\.)/.test(path) && !path.endsWith(".env.example")) throw new Error(`Unexpected environment file: ${path}`);
  const content = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT" && gitFiles.includes(path)) return "";
    throw error;
  });
  if (values.some((value) => content.includes(value))) throw new Error(`A local secret value was found in ${path}`);
  if (publicFiles.includes(path) && /AZURE_OPENAI_API_KEY|AZURE_SEARCH_API_KEY|api\/src\/server/.test(content)) throw new Error(`Backend configuration entered the frontend: ${path}`);
  if (backendFiles.includes(path) && /Local mock book|External provider calls are forbidden/.test(content)) throw new Error(`Test fixtures entered the backend: ${path}`);
}
const ignored = execFileSync("git", ["check-ignore", "api/.env", ".env.local"], { encoding: "utf8" }).trim().split(/\r?\n/);
if (ignored.length !== 2) throw new Error("Local configuration is not fully ignored.");
const exclusions = await readFile("api/.funcignore", "utf8");
for (const required of [".env", ".env.*", "local.settings.json", ".test-host/", ".local-storage/", "scripts/", "node_modules/azurite/"]) {
  if (!exclusions.split(/\r?\n/).includes(required)) throw new Error(`Missing backend packaging exclusion: ${required}`);
}
console.log(JSON.stringify({ checkedFiles: all.length, publicFiles: publicFiles.length, backendFiles: backendFiles.length, knownSecretsChecked: values.length, secretLeaks: 0, productionMocks: 0 }));
