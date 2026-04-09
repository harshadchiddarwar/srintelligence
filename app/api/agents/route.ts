import { agentRegistry } from '../../../src/lib/agents/agent-registry';

export async function GET(): Promise<Response> {
  try {
    const agents = agentRegistry.getAgentDescriptions();
    return Response.json({ agents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
