import type { Agent } from '@atproto/api';

/**
 * A recording stub standing in for the santa/robot Bluesky agents.
 *
 * Any method that is not part of the known interface throws, so tests fail
 * loudly if app code tries to call something we have not deliberately stubbed.
 */
export class RecordingAgentStub {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  readonly sessionManager: { did: string };

  readonly posts: Array<{
    text: string | undefined;
    facets: unknown;
  }> = [];
  private nextRkey = 1;
  private nextFollowCount = 1;
  private readonly identityByHandle: Map<string, string>;

  constructor(did: string, identityByHandle: Map<string, string>) {
    this.sessionManager = { did };
    this.identityByHandle = identityByHandle;
  }

  // Sugar used by NudgeSender (`client.post`)
  post(
    options: {
      text?: string;
      facets?: unknown;
    } & Record<string, unknown>
  ) {
    this.calls.push({ method: 'post', args: [options] });
    this.posts.push({ text: options.text, facets: options.facets });
    const rkey = this.nextRkey++;
    return Promise.resolve({
      uri: `at://${this.sessionManager.did}/app.bsky.feed.post/${options.rkey ?? `r${rkey}`}`,
      cid: 'cid-none',
      validationStatus: 'valid' as const,
    });
  }

  // Sugar used by PlayerService.auto-follow
  follow(did: string) {
    this.calls.push({ method: 'follow', args: [did] });
    const n = this.nextFollowCount++;
    return Promise.resolve({
      uri: `at://${this.sessionManager.did}/app.bsky.graph.follow/f${n}`,
      cid: 'cid-none',
    });
  }

  // Sugar used by admin player-create
  resolveHandle(options: { handle: string }) {
    this.calls.push({ method: 'resolveHandle', args: [options] });
    // Unknown handles get a deterministic synthetic DID (consistent with the
    // fake app-view's profile synthesis), mirroring real bluesky behaviour
    // where any registered handle resolves.
    let did = this.identityByHandle.get(options.handle);
    if (did == null) {
      did = `did:plc:e2e${options.handle.split('.')[0]}`;
      this.identityByHandle.set(options.handle, did);
    }
    return Promise.resolve({ data: { did }, success: true });
  }

  // Used by RichText.detectFacets for mention facets
  readonly com = {
    atproto: {
      identity: {
        resolveHandle: (options: { handle: string }) => {
          const did = this.identityByHandle.get(options.handle);
          if (did == null) {
            return Promise.reject(new Error('Unable to resolve handle'));
          }
          return Promise.resolve({ data: { did } });
        },
      },
    },
  };

  // Used by DmSender for Bluesky DMs
  readonly api = {
    chat: {
      bsky: {
        convo: {
          getConvoForMembers: (_params: unknown) => {
            this.calls.push({
              method: 'getConvoForMembers',
              args: [_params],
            });
            return Promise.resolve({
              data: { convo: { id: 'convo-1' } },
              success: true,
            });
          },
          sendMessage: (params: unknown) => {
            this.calls.push({ method: 'sendMessage', args: [params] });
            return Promise.resolve({
              data: {},
              success: true,
            });
          },
        },
      },
    },
  };

  get dms(): Array<{ text: string | undefined }> {
    return this.calls
      .filter(
        ({ method }) =>
          method === 'sendMessage' || method === 'getConvoForMembers'
      )
      .map(({ args }) => {
        const [params] = args as Array<{
          message?: { text?: string };
        }>;
        return { text: params?.message?.text };
      })
      .filter((entry) => entry.text != null);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asAgent = (stub: RecordingAgentStub): Agent => stub as any;
