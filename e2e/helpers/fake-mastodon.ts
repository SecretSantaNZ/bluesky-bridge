import { http, HttpResponse } from 'msw/http';
import { fakeBlueskyServer } from './fake-bluesky.js';
import { identityByHandle } from './users.js';

/**
 * A fake Mastodon instance backing the fake Mastodon OAuth login flow for
 * brand-new signups (e2e/signup.spec.ts). Its handlers are registered on top
 * of the fake Bluesky app-view's msw server, so the same rules apply: any
 * *other* outbound request fails the test loudly, guaranteeing that nothing
 * is ever sent to a real Mastodon instance.
 */
export const mastodonHost = 'mastodon.test';

/** Bridgy-fed style mapping: Mastodon account -> bridged Bluesky handle. */
export const bridgedBlueskyHandles = new Map<string, string>([
  ['newbie@mastodon.test', 'newbie.test.bsky.social'],
]);

// The login callback resolves the DID for the bridged Bluesky handle through
// the fake app-view, so the identity has to be known there.
identityByHandle.set('newbie.test.bsky.social', 'did:plc:e2enewbie');

fakeBlueskyServer.use(
  http.get('**/.well-known/webfinger', ({ request }) => {
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource') ?? '';
    const acct = resource.replace(/^acct:/, '').toLowerCase();
    const [username] = acct.split('@');
    if (bridgedBlueskyHandles.has(acct)) {
      return HttpResponse.json({
        subject: resource,
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: `https://${mastodonHost}/users/${username ?? ''}`,
          },
        ],
      });
    }
    return HttpResponse.json({ error: 'Record not found' }, { status: 404 });
  }),
  http.post('**/api/v1/apps', () =>
    HttpResponse.json({
      client_id: 'fake-client-id',
      client_secret: 'fake-client-secret',
    })
  ),
  http.post('**/oauth/token', () =>
    HttpResponse.json({
      access_token: 'fake-access-token',
      token_type: 'Bearer',
      scope: 'profile',
      created_at: 1764000000,
    })
  ),
  http.get('**/api/v1/accounts/verify_credentials', () =>
    HttpResponse.json({ id: '1', username: 'newbie', acct: 'newbie' })
  )
);
