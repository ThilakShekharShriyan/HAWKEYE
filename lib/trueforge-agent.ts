/** Saved agent name. Registered by `npm run trueforge:setup`. */
export const TRUEFORGE_AGENT_NAME = "worldstate-answer";

export const TRUEFORGE_AGENT_DESCRIPTION =
  "Answers a spoken question about a shared physical place from the WORLDSTATE graph.";

/** FalkorDB MCP tools that only read. Writes stay off so a question cannot change the graph. */
export const FALKOR_READ_TOOLS = [
  "query_graph_readonly",
  "list_graphs",
  "get_graph_schema",
  "get_node_schema",
  "get_relationship_schema",
] as const;

export const WORLDSTATE_INSTRUCTIONS = `You are WORLDSTATE. Answer a spoken question about a shared physical place.
The world state in the message is the truth for what is there now.
A taken or gone event means the thing left. When a graph path is shown, use it to say who saw it and which place it was.
Two places of the same kind are different places: "table" and "table 2" are not the same node.
Use the FalkorDB tools when you need a path the message does not already contain. Read only.
Use the worldstate-graph skill when you need the Cypher for who has what, who took it, or what to buy.
Use live web listings only to say where something could be bought.
One or two short sentences, no markdown. The answer is spoken aloud.`;

export type WorldstateAgentSpec = {
  model: { name: string; params: { temperature: number } };
  instructions: string;
  responseFormat: { type: "text" };
  mcpServers?: { name: string; enableTools: string[]; requireApprovalForTools: string[]; preload: false }[];
  skills?: { name: string; preload: false }[];
  config: {
    iterationLimit: number;
    sandbox: { enabled: boolean };
    webSearch: { enabled: false };
    askUserQuestions: { enabled: false };
    dynamicSubAgents: { enabled: false };
    generativeUi: { enabled: false };
  };
};

/** Official agent spec: model, instructions, FalkorDB MCP, and the graph skill. */
export function worldstateAgentSpec(options: {
  model: string;
  mcp?: boolean;
  skill?: boolean;
}): WorldstateAgentSpec {
  return {
    model: { name: options.model, params: { temperature: 0.2 } },
    instructions: WORLDSTATE_INSTRUCTIONS,
    responseFormat: { type: "text" },
    ...(options.mcp
      ? {
          mcpServers: [
            {
              name: "falkordb",
              enableTools: [...FALKOR_READ_TOOLS],
              requireApprovalForTools: [],
              preload: false as const,
            },
          ],
        }
      : {}),
    ...(options.skill ? { skills: [{ name: "worldstate-graph", preload: false as const }] } : {}),
    config: {
      iterationLimit: 8,
      sandbox: { enabled: Boolean(options.skill) },
      webSearch: { enabled: false },
      askUserQuestions: { enabled: false },
      dynamicSubAgents: { enabled: false },
      generativeUi: { enabled: false },
    },
  };
}
