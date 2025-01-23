import { Agent, AtpAgent } from '@atproto/api';
import type { NodeOAuthClient } from '@atproto/oauth-client-node';
import memoize from 'memoizee';

export const unauthenticatedAgent = new AtpAgent({
  service: 'https://public.api.bsky.app',
});

export const resolveHandle = async (handle: string): Promise<string> => {
  const resolveHandle = await unauthenticatedAgent.resolveHandle({
    handle,
  });
  return resolveHandle.data.did;
};

export const buildAtpClient = async (
  client: NodeOAuthClient,
  handle: string
): Promise<[() => Promise<Agent>, string]> => {
  const did = await resolveHandle(handle);
  return [
    memoize(
      async () => {
        const session = await client.restore(did);
        return new Agent(session);
      },
      { promise: true }
    ),
    did,
  ];
};
