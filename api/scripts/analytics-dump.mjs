import { existsSync } from "node:fs";
import { TableClient } from "@azure/data-tables";

// Prints row counts and the newest rows of every analytics table.
// Usage: npm run analytics:dump [-- --rows=10] [-- --table=plutousers]
if (existsSync(".env")) process.loadEnvFile(".env");
const connection = process.env.ANALYTICS_STORAGE_CONNECTION_STRING?.trim();
if (!connection) throw new Error("Set ANALYTICS_STORAGE_CONNECTION_STRING in api/.env first.");
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
const limit = Number(arg("rows") ?? 3);
const only = arg("table");
const tables = ["plutousers", "plutosessions", "plutoactivity", "plutoanalytics", "plutofeedback", "plutoevents"].filter((name) => !only || name === only);

for (const name of tables) {
  const client = TableClient.fromConnectionString(connection, name, { allowInsecureConnection: connection.includes("http://") });
  const rows = [];
  try {
    for await (const row of client.listEntities()) {
      const { etag, timestamp, ["odata.metadata"]: meta, partitionKey, rowKey, ...rest } = row;
      void etag; void meta; rows.push({ ...rest, _key: `${partitionKey}/${rowKey}`, _written: timestamp });
    }
  } catch (error) {
    console.log(`\n${name}: ${error.statusCode === 404 ? "table not created yet (nothing written)" : `error ${error.message}`}`);
    continue;
  }
  rows.sort((a, b) => String(b._written).localeCompare(String(a._written)));
  console.log(`\n=== ${name}: ${rows.length} row(s) ===`);
  for (const row of rows.slice(0, limit)) { const { _written, ...rest } = row; console.log(JSON.stringify(rest)); }
}
