import { cp, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

await mkdir(".next/standalone/.next", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
const entries = await readdir(".");
if (entries.includes("public")) {
  await cp("public", ".next/standalone/public", { recursive: true });
}
const deployed = await readdir(".next/standalone");
// Next copies environment files separately from its dependency tracing exclusions.
for (const name of deployed) {
  if (name === ".env" || name.startsWith(".env.")) {
    await unlink(join(".next/standalone", name));
  }
}
if ((await readdir(".next/standalone")).some((name) => name === ".env" || name.startsWith(".env."))) {
  throw new Error("An environment file was included in the deployment artifact. Do not deploy it.");
}
