import { connection } from "next/server";
import { log } from "@/lib/log";
import { readHouseGraph } from "@/lib/house-graph";

// The house as nodes and links for the 3D view.
export async function GET() {
  await connection();
  try {
    return Response.json(await readHouseGraph(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    log("house", "graph failed", { error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "house graph unavailable" }, { status: 503 });
  }
}
