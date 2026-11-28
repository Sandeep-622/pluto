import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "@api": fileURLToPath(new URL("./api/src", import.meta.url)), "@azure/functions": fileURLToPath(new URL("./api/node_modules/@azure/functions", import.meta.url)), "@azure/data-tables": fileURLToPath(new URL("./api/node_modules/@azure/data-tables", import.meta.url)),"google-auth-library": fileURLToPath(new URL("./api/node_modules/google-auth-library", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" }
});
