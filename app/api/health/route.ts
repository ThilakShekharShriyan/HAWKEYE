import { connection } from "next/server";
import { agentMemoryStatus } from "@/lib/agent-memory";
import { hasAnswerAgent } from "@/lib/answer-agent";
import { hasBrightData } from "@/lib/bright-data";
import { graphStatus } from "@/lib/graph";
import { groqKeyCount } from "@/lib/groq";
import { hasModel, provider } from "@/lib/llm";
import { trackerStatus } from "@/lib/tracker";

export async function GET() {
  await connection();
  try {
    const status = await graphStatus();
    return Response.json({
      ok: true,
      database: `falkordb:${status.graph}`,
      pingMs: status.pingMs,
      indexes: status.indexes,
      model: hasModel() ? provider() : null,
      agentMemory: await agentMemoryStatus(),
      answerAgent: hasAnswerAgent() ? "trueforge" : "in-process",
      brightData: hasBrightData(),
      groqKeys: groqKeyCount(),
      tracker: await trackerStatus(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
