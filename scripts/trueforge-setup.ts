import { TrueForge } from "@truefoundry/trueforge-sdk";
import {
  TRUEFORGE_AGENT_DESCRIPTION,
  TRUEFORGE_AGENT_NAME,
  worldstateAgentSpec,
} from "../lib/trueforge-agent.ts";

const baseUrl = (process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790").replace(/\/$/, "");
const modelId = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const modelName = modelId.replace(/\./g, "-");
const mcpUrl = process.env.FALKORDB_MCP_URL ?? "http://localhost:3005";
const skillUrl = process.env.TRUEFORGE_SKILL_URL ?? "https://github.com/arnxv0/worldstate-mongodb";
const skillRef = process.env.TRUEFORGE_SKILL_REF ?? "main";

function safe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-…").slice(0, 400);
}

const client = new TrueForge({
  baseUrl,
  timeoutInSeconds: 30,
  maxRetries: 0,
  ...(process.env.TRUEFORGE_TOKEN ? { token: process.env.TRUEFORGE_TOKEN } : {}),
});

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.error("OPENAI_API_KEY is empty. TrueForge models are configured from that key.");
  process.exit(1);
}

try {
  await client.settings.modelProviders.createOrUpdate({
    manifest: {
      type: "openai",
      auth: { apiKey },
      models: [{ modelId, name: modelName, properties: { contextLength: 128000, maxOutputTokens: 16384 } }],
    },
  });
  console.log(`model provider openai, agent model openai/${modelName} (OpenAI id ${modelId})`);
} catch (error) {
  console.error(`model provider failed: ${safe(error)}`);
  console.error("Start TrueForge first: npm run trueforge");
  process.exit(1);
}

const models = await client.models.list();
const fqn = models.data.find((model) => model.modelId === modelId)?.name ?? `openai/${modelName}`;
console.log(`models available: ${models.data.map((model) => model.name).join(", ") || "(none)"}`);

const mcpKey = process.env.FALKORDB_MCP_API_KEY?.trim() || process.env.MCP_API_KEY?.trim();
let mcp = false;
try {
  await client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: "remote",
      name: "falkordb",
      url: mcpUrl,
      description: "Read the WORLDSTATE FalkorDB graph: places, things, and who took what.",
      ...(mcpKey ? { auth: { type: "header" as const, headers: { Authorization: `Bearer ${mcpKey}` } } } : {}),
    },
  });
  mcp = true;
  console.log(`mcp server falkordb at ${mcpUrl}`);
} catch (error) {
  console.error(`mcp server skipped: ${safe(error)}`);
  console.error("Start it with: npm run mcp:falkor");
}

let skill = false;
try {
  await client.settings.skills.createOrUpdate({
    manifest: {
      type: "git",
      name: "worldstate-graph",
      url: skillUrl,
      ref: skillRef,
      path: "trueforge/skills/worldstate-graph",
      description: "Read the WORLDSTATE FalkorDB graph before answering who has what, who took it, or what to buy.",
    },
  });
  console.log(`skill worldstate-graph from ${skillUrl} @ ${skillRef}`);
  const published = await fetch(
    `${skillUrl.replace(/\.git$/, "")}/blob/${skillRef}/trueforge/skills/worldstate-graph/SKILL.md`,
  ).then((response) => response.ok, () => false);
  if (published) skill = true;
  else console.log("skill stays unattached until that path is on the public repo; the prompt and FalkorDB MCP still answer");
} catch (error) {
  console.error(`skill skipped: ${safe(error)}`);
}

let sandbox = false;
const daytonaKey = process.env.DAYTONA_API_KEY?.trim();
if (daytonaKey) {
  try {
    await client.settings.sandboxProviders.createOrUpdate({
      manifest: {
        type: "daytona",
        auth: { apiKey: daytonaKey },
        autoStopIntervalInMinutes: 15,
        autoArchiveIntervalInMinutes: 60,
        autoDeleteIntervalInMinutes: 1440,
        execTimeoutMs: 60_000,
      },
    });
    sandbox = true;
    console.log("sandbox provider daytona");
  } catch (error) {
    console.error(`sandbox skipped: ${safe(error)}`);
  }
} else {
  console.log("sandbox: local npx fallback (set DAYTONA_API_KEY for a hosted sandbox)");
}

const manifest = worldstateAgentSpec({ model: fqn, mcp, skill: skill && (sandbox || !daytonaKey) });
const description = TRUEFORGE_AGENT_DESCRIPTION;
const existing = [];
for await (const agent of await client.agents.list({ agentName: TRUEFORGE_AGENT_NAME })) {
  if (agent.name === TRUEFORGE_AGENT_NAME) existing.push(agent);
}
try {
  if (existing[0]) {
    await client.agents.update(existing[0].id, { description, manifest });
    console.log(`updated agent ${TRUEFORGE_AGENT_NAME} (${existing[0].id})`);
  } else {
    const created = await client.agents.create({ name: TRUEFORGE_AGENT_NAME, description, manifest });
    console.log(`created agent ${TRUEFORGE_AGENT_NAME} (${created.data.id})`);
  }
} catch (error) {
  console.error(`agent with skill failed, saving it without the skill: ${safe(error)}`);
  const plain = worldstateAgentSpec({ model: fqn, mcp });
  if (existing[0]) await client.agents.update(existing[0].id, { description, manifest: plain });
  else await client.agents.create({ name: TRUEFORGE_AGENT_NAME, description, manifest: plain });
}
console.log(`chat ui ${baseUrl}`);
