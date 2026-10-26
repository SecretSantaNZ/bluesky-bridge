import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * Click something that fires an alpine-ajax form submit and wait for the
 * corresponding POST to complete (Playwright's click() returns before the
 * fetch even starts).
 */
export const submitAndWait = async (
  page: Page,
  urlPart: string,
  click: () => Promise<void>
) => {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(urlPart) && r.request().method() === 'POST'
    ),
    click(),
  ]);
  expect(response.status()).toBeLessThan(400);
  return response;
};

// IMPORTANT: the msw fake appview must be listening before any src/ module is
// imported -- @atproto captures globalThis.fetch at construction time, so the
// interception has to be in place first.
import './helpers/fake-bluesky.js';

import { build } from '../src/app.js';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../src/lib/database/index.js';
import { Bridge } from '../src/bridge.js';
import type { TokenManager } from '../src/lib/TokenManager.js';
import type { PlayerService } from '../src/lib/PlayerService.js';
import type { NudgeSender } from '../src/lib/NudgeSender.js';
import type { DmSender } from '../src/lib/DmSender.js';
import type { NodeOAuthClient } from '@atproto/oauth-client-node';
import type { DidResolver } from '@atproto/identity';
import type { Selectable } from 'kysely';
import type { Settings, Player } from '../src/lib/database/schema.js';
import type { SelectedSettings } from '../src/lib/settings.js';
import { loadSettings } from '../src/lib/settings.js';
import { setSettings, defaultSettings } from './helpers/state.js';

import { RecordingAgentStub, asAgent } from './helpers/stubs.js';
import {
  identityByHandle,
  insertPlayerRow,
  robotDid,
  santaDid,
  seedUsers,
  type StaticUser,
  staticUsers,
} from './helpers/users.js';

// The client config from `node build-client.mjs build `. Since views reference
// the hashed asset names via env, set them before the app is built.
try {
  const clientEnv = await fs.readFile('.env.client.prod', 'utf-8');
  for (const line of clientEnv.split('\n')) {
    const match = line.match(/^(\w+)="(.*)"$/);
    if (match?.[1] && match?.[2]) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  // No client build present; templates fall back to unhashed asset names.
}

// Google Places geocoding is gRPC-based and cannot be intercepted with msw --
// stub the client method so address saving and admin player creation resolve
// to "no location found" locally.
import { v1 as placesV1 } from '@googlemaps/places';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const placesProto = (placesV1.PlacesClient as any).prototype;
placesProto.searchText = async () => [
  { places: [{ location: { latitude: -41.28664, longitude: 174.77557 } }] },
  {},
];

const TOKEN_ISSUER = 'https://e2e.secretsanta.test';

export interface AppHandle {
  baseUrl: string;
  db: Database;
  santaAgent: RecordingAgentStub;
  robotAgent: RecordingAgentStub;
  playerService: PlayerService;
  nudgeSender: NudgeSender;
  dmSender: DmSender;
  authTokenManager: TokenManager<{
    csrfToken: string;
    startedAt: string;
    handle: string;
    admin?: true;
  }>;

  /** Seed one of the static users (fresh row). */
  insertPlayer(
    u: StaticUser,
    overrides?: Parameters<typeof insertPlayerRow>[2]
  ): ReturnType<typeof insertPlayerRow>;

  /** Sign into a page as a static user with a minted session cookie. */
  login(page: Page, key: string): Promise<void>;

  /**
   * Run `fn` while the process clock is pinned inside the senders' 9am-8pm
   * NZT window, so sendANudge/sendADm actually send.
   */
  withFixedTimeWindow(fn: () => Promise<void>): Promise<void>;

  /** Refresh the settings row cache after direct DB updates. */
  loadSettings(): ReturnType<typeof loadSettings>;
  getSettings(): Promise<Selectable<Settings>>;
}

const buildApp = async (): Promise<AppHandle> => {
  const db = createDb();
  await migrateToLatest(db);
  await seedUsers(db);
  await setSettings(db, defaultSettings());

  const santaAgentStub = new RecordingAgentStub(santaDid, identityByHandle);
  const robotAgentStub = new RecordingAgentStub(robotDid, identityByHandle);

  // Bridgy-fed and Mastodon lookups are inherently external services with no
  // meaningful fake that the bridge consumes over HTTP. They resolve to "no
  // bridge account" for all e2e sessions.
  const bridgedLookups = {
    lookupBridgedMastodonHandle: async () => null,
    lookupBridgedBlueskyHandle: async () => null,
    lookupMastodonFollowing: async () => undefined,
  };

  const atOauthClient = {
    clientMetadata: { client_id: `${TOKEN_ISSUER}/client-metadata.json` },
    jwks: { keys: [] },
    authorize: async () => {
      throw new Error('Full OAuth flow is not exercised in e2e tests');
    },
    callback: async () => {
      throw new Error('Full OAuth flow is not exercised in e2e tests');
    },
    restore: async () => {
      throw new Error('Full OAuth flow is not exercised in e2e tests');
    },
  };

  const didResolver = {
    resolve: async (did: string) => {
      const u = staticUsers.find((candidate) => candidate.did === did);
      if (u == null) {
        throw new Error(`Unable to resolve did ${did}`);
      }
      return {
        did,
        alsoKnownAs: [`at://${u.handle}`],
        verificationMethod: [],
      };
    },
  };

  // The app is built through the shared composition root (src/bridge.ts) so
  // the harness cannot drift from production wiring; fakes are passed as
  // seams. `bridge.init()` is the timer-free bootstrap; the background loops
  // (`bridge.start()`) are never started in tests.
  const bridge = await Bridge.build(
    {
      tokenIssuer: TOKEN_ISSUER,
      santaHandle: 'santa.test.bsky.social',
      robotHandle: 'robot.test.bsky.social',
      santaMastodonHandle: '@santa.test.bsky.social',
      santaMastodonHost: 'test.bsky.social',
      ensureElfHandles: [],
    },
    {
      db,
      agentSource: (handle) => {
        const did = identityByHandle.get(handle);
        if (did == null) {
          throw new Error(`Unknown agent handle ${handle}`);
        }
        const stub =
          handle === 'santa.test.bsky.social' ? santaAgentStub : robotAgentStub;
        return [async () => asAgent(stub), did];
      },
      atOauthClient: atOauthClient as unknown as NodeOAuthClient,
      didResolver: didResolver as unknown as DidResolver,
      ensureElfDids: new Set(['did:plc:e2eheadelf']),
      bridgedLookups,
    }
  );
  await bridge.init();

  const app = await build({ logger: false }, bridge.blueskyBridge);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${(app.server?.address() as { port: number }).port}`;

  const withFixedTimeWindow = async (fn: () => Promise<void>) => {
    // 25 Dec 2025: NZDT (UTC+13) -> 12:00 NZ time on christmas morning.
    const fixedEpoch = Date.parse('2025-12-25T23:00:00.000Z');
    const RealDate = Date;
    class PatchedDate extends RealDate {
      constructor(...args: [] | ConstructorParameters<typeof RealDate>) {
        if (args.length === 0) {
          super(fixedEpoch);
        } else {
          super(...(args as ConstructorParameters<typeof RealDate>));
        }
      }
      static override now(): number {
        return fixedEpoch;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = PatchedDate;
    try {
      await fn();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Date = RealDate;
    }
  };

  return {
    baseUrl,
    db,
    santaAgent: santaAgentStub,
    robotAgent: robotAgentStub,
    playerService: bridge.playerService,
    nudgeSender: bridge.nudgeSender,
    dmSender: bridge.dmSender,
    authTokenManager: bridge.authTokenManager,
    insertPlayer: async (u, overrides) => {
      // Insert (or re-insert, replacing any seeded row) a static user
      await db.deleteFrom('player').where('did', '=', u.did).execute();
      return insertPlayerRow(db, u, overrides);
    },
    login: async (page: Page, key: string) => {
      const u = staticUsers.find((candidate) => candidate.key === key);
      if (u == null) {
        throw new Error(`Unknown user key ${key}`);
      }
      const token = await bridge.authTokenManager.generateToken(u.did, {
        csrfToken: randomUUID(),
        startedAt: new Date().toISOString(),
        handle: u.handle,
        admin: u.admin ? true : undefined,
      });
      await page.context().addCookies([
        {
          name: 'session',
          value: token,
          url: baseUrl,
        },
      ]);
    },
    withFixedTimeWindow,
    loadSettings: () => loadSettings(db),
    getSettings: async () =>
      db
        .selectFrom('settings')
        .selectAll()
        .where('id', '=', 0)
        .executeTakeFirstOrThrow(),
  };
};

const teardownApp = async (app: AppHandle) => {
  // Nothing to close: the db is per-test in-memory and the fastify server is
  // owned by the build() instance. Closing the app unblocks sockets.
  await app.db.destroy();
};

type TestFixtures = {
  app: AppHandle;
  page: Page;
};

export const test = base.extend<TestFixtures>({
  app: [
    async (
      // eslint-disable-next-line no-empty-pattern -- fixtures suite: we depend on nothing
      {},
      use
    ) => {
      const app = await buildApp();
      await use(app);
      await teardownApp(app);
    },
    { scope: 'test' },
  ],
  page: async ({ browser, app }, use) => {
    const context = await browser.newContext({
      baseURL: app.baseUrl,
    });
    const page = await context.newPage();
    // Nothing may reach the internet from the browser: any external request
    // (fonts, image CDNs, analytics) is aborted immediately.
    await context.route(
      (url) => !url.href.startsWith(app.baseUrl),
      (route) => route.abort()
    );
    await use(page);
    await context.close();
  },
});

export { expect };
export type { SelectedSettings, Player };
