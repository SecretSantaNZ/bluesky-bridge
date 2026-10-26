import { setupServer } from 'msw/node';
import { http, HttpResponse, passthrough } from 'msw';
import { usersByDid, usersByHandle, identityByHandle } from './users.js';

/**
 * A fake Bluesky app-view for the endpoints the bridge actually calls. Any
 * other outbound request fails the test loudly (onUnhandledRequest: 'error'),
 * guaranteeing that nothing is ever sent to real Bluesky or Mastodon.
 */
const handlesMarkedPrivate = new Set<string>();

export const markProfilePrivate = (handle: string) =>
  handlesMarkedPrivate.add(handle);

export const fakeBlueskyServer = setupServer();
fakeBlueskyServer.listen({ onUnhandledRequest: 'error' });

fakeBlueskyServer.use(
  // The app under test runs on 127.0.0.1 -- never intercept its own traffic
  http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
  http.get('**/xrpc/com.atproto.identity.resolveHandle', ({ request }) => {
    const url = new URL(request.url);
    const handle = url.searchParams.get('handle') ?? '';
    const did = identityByHandle.get(handle);
    if (did == null) {
      return HttpResponse.json(
        {
          error: 'InvalidRequest',
          message: `Unable to resolve handle: ${handle}`,
        },
        { status: 400 }
      );
    }
    return HttpResponse.json({ did });
  }),
  http.get('**/xrpc/app.bsky.actor.getProfile', ({ request }) => {
    const url = new URL(request.url);
    const actor = url.searchParams.get('actor') ?? '';
    const u = usersByHandle.get(actor) ?? usersByDid.get(actor) ?? null;
    // Unknown actors (e.g. admin-created players) get a synthesized profile
    const did =
      u?.did ??
      (actor.startsWith('did:') ? actor : `did:plc:e2e${actor.split('.')[0]}`);
    const handle =
      u?.handle ??
      (actor.startsWith('did:') ? `${actor}.test.bsky.social` : actor);
    const profileKey = u?.key ?? handle.split('.')[0] ?? '';
    return HttpResponse.json({
      did,
      handle,
      displayName: profileKey.toUpperCase(),
      avatar: `https://cdn.example.com/avatars/${profileKey}.png`,
      postsCount: 3,
      labels: handlesMarkedPrivate.has(handle)
        ? [{ val: '!no-unauthenticated', src: 'self', uri: '', cid: '' }]
        : [],
      associated: {
        chat: {
          allowIncoming: u?.dms_disabled ? 'none' : 'all',
        },
      },
    });
  }),
  http.get('**/xrpc/app.bsky.graph.getRelationships', ({ request }) => {
    const url = new URL(request.url);
    const others = url.searchParams.get('others') ?? '';
    const u = usersByDid.get(others);
    if (u == null || u.not_following) {
      return HttpResponse.json({ relationships: [] });
    }
    return HttpResponse.json({
      relationships: [
        {
          $type: 'app.bsky.graph.defs#relationship',
          did: u.did,
          followedBy: `at://${url.searchParams.get('actor')}/app.bsky.graph.follow/rel-1`,
          following: `at://${u.did}/app.bsky.graph.follow/rel-2`,
        },
      ],
    });
  })
);
