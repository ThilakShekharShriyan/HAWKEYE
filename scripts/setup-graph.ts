import { ensureSchema, graphStatus } from "../lib/graph.ts";

try {
  console.log("setting up FalkorDB graph");
  await ensureSchema();
  const status = await graphStatus();
  console.log(`  graph ${status.graph} (${status.pingMs} ms)`);
  for (const index of status.indexes) {
    console.log(`  index ${index.label} ${index.types} on ${index.properties}: ${index.status || "ok"}`);
  }
  console.log("done");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Start FalkorDB first: npm run db:up");
  process.exit(1);
}
