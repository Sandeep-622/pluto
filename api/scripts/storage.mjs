import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { stopChild } from "./process.mjs";

export async function startLocalStorage(folder) {
  for (const port of [10010, 10011, 10012]) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () => reject(new Error(`Local storage port ${port} is already in use. Stop that preview before starting Pluto.`)));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
  }
  const account = "plutolocal";
  const key = randomBytes(64).toString("base64");
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME"].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/azurite/dist/src/azurite.js", import.meta.url)), "--silent", "--location", folder, "--blobHost", "127.0.0.1", "--blobPort", "10010", "--queueHost", "127.0.0.1", "--queuePort", "10011", "--tableHost", "127.0.0.1", "--tablePort", "10012", "--skipApiVersionCheck"], { env: { ...env, AZURITE_ACCOUNTS: `${account}:${key}` }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  let failure;
  child.stdout.on("data", (value) => { logs = (logs + value).slice(-6000); });
  child.stderr.on("data", (value) => { logs = (logs + value).slice(-6000); });
  child.on("error", (error) => { failure = error; });
  let stopping;
  const stop = () => stopping ??= stopChild(child);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Local storage emulator exited: ${logs}`);
      const responses = await Promise.all([10010, 10011, 10012].map((port) => fetch(`http://127.0.0.1:${port}/`, { method: "HEAD", signal: AbortSignal.timeout(700) }).catch((error) => {
        if (error instanceof TypeError || error.name === "TimeoutError") return undefined;
        throw error;
      })));
      if (responses.every((response) => response?.headers.get("server")?.startsWith("Azurite-"))) { ready = true; break; }
      await delay(250);
    }
    if (!ready) throw new Error(`Local storage emulator did not become ready: ${logs}`);
    const connectionString = `DefaultEndpointsProtocol=http;AccountName=${account};AccountKey=${key};BlobEndpoint=http://127.0.0.1:10010/${account};QueueEndpoint=http://127.0.0.1:10011/${account};TableEndpoint=http://127.0.0.1:10012/${account}`;
    console.log("Project-local storage emulator ready on ports 10010-10012; Azure host storage is not used.");
    return { connectionString, stop, exited };
  } catch (error) { await stop(); throw error; }
}
