import { FalkorDB } from "falkordb";

export async function connect(graphName = process.env.HAWKEYE_GRAPH ?? "hawkeye") {
  const db = await FalkorDB.connect({
    socket: {
      host: process.env.FALKORDB_HOST ?? "localhost",
      port: Number(process.env.FALKORDB_PORT ?? 6390),
    },
  });
  return { db, graph: db.selectGraph(graphName) };
}

export type Graph = Awaited<ReturnType<typeof connect>>["graph"];
