import { Agent, AtpAgent } from '@atproto/api';
import type { NodeOAuthClient } from '@atproto/oauth-client-node';

export const unauthenticatedAgent = new AtpAgent({
  service: 'https://public.api.bsky.app',
});

export const buildAtpClient = async (
  client: NodeOAuthClient,
  handle: string
) => {
  const resolveHandle = await unauthenticatedAgent.resolveHandle({ handle });
  const session = await client.restore(resolveHandle.data.did);
  return new Agent(session);
};
