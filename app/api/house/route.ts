import { createHash } from "node:crypto";
import { connection } from "next/server";
import { log } from "@/lib/log";
import { readHouseGraph } from "@/lib/house-graph";

// The house as nodes and links for the 3D view.
export async function GET(request: Request) {
  await connection();
  try {
    const graph = await readHouseGraph();
    // Polls send the last ETag back; an unchanged house costs a 304, not the whole graph.
    const etag = `"${createHash("sha1").update(JSON.stringify(graph)).digest("hex")}"`;
    const headers = { "Cache-Control": "no-store", ETag: etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(graph, { headers });
  } catch (error) {
    log("house", "graph failed", { error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "house graph unavailable" }, { status: 503 });
  }
}
