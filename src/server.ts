import path from 'path';
import dotenv from 'dotenv';
import { DidResolver, MemoryCache } from '@atproto/identity';

import { build } from './app.js';
// import { Subscription } from './subscription.js';
import { OauthSessionStore } from './lib/oauth.js';
import { TokenManager } from './lib/TokenManager.js';
import { createDb, migrateToLatest } from './lib/database/index.js';
import { buildAtpClient, resolveHandle } from './bluesky.js';
import { PlayerService } from './lib/PlayerService.js';
import { NudgeSender } from './lib/NudgeSender.js';
import { DmSender } from './lib/DmSender.js';
import { initAtLoginClient } from './lib/initAtLoginClient.js';
import { FirehoseSubscription } from './subscription.js';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    `${process.env.CREDENTIALS_DIRECTORY}/bluesky-bridge-creds`,
  ],
});

const resolveEnsureElfHandles = async (): Promise<Array<string>> => {
  const handles = process.env.ENSURE_ELF_HANDLES;
  if (!handles) {
    return [];
  }
  return Promise.all(
    handles.split(',').map((handle) => resolveHandle(handle.trim()))
  );
};

const main = async () => {
  const db = createDb();
  await migrateToLatest(db);

  const oauthSessionStore = new OauthSessionStore(db);
  oauthSessionStore.registerClient({
    client_id: process.env.OAUTH_CLIENT_ID as string,
    client_secret_hash: process.env.OAUTH_CLIENT_SECRET_HASH as string,
    redirectUris: new Set([process.env.OAUTH_REDIRECT_URI as string]),
  });

  const tokenIssuer = process.env.TOKEN_ISSUER as string;
  const returnTokenManager = new TokenManager<{ returnUrl: string }>(
    db,
    tokenIssuer,
    `${tokenIssuer}/oauth/login`,
    '7 days'
  );
  const authTokenManager = new TokenManager<{
    csrfToken: string;
    startedAt: string;
    admin?: true;
  }>(db, tokenIssuer, `${tokenIssuer}/endpoints`, '15 minutes');

  const [atOauthClient] = await Promise.all([
    initAtLoginClient({
      database: db,
      basePath: process.env.PUBLIC_BASE_URL as string,
    }),
    returnTokenManager.initialize(),
    authTokenManager.initialize(),
  ]);
  const santaHandle = process.env.SANTA_BLUESKY_HANDLE as string;
  const robotHandle = process.env.ROBOT_BLUESKY_HANDLE as string;
  const [[santaAgent, santaAccountDid], [robotAgent], ensureElfDids] =
    await Promise.all([
      buildAtpClient(atOauthClient, santaHandle),
      buildAtpClient(atOauthClient, robotHandle),
      resolveEnsureElfHandles(),
    ]);
  const didResolver = new DidResolver({
    didCache: new MemoryCache(),
    plcUrl: 'https://plc.directory',
    timeout: 3000,
  });

  const nudgeSender = new NudgeSender(db, robotAgent);
  const dmSender = new DmSender(db, santaAgent);
  const playerService = new PlayerService(
    db,
    santaAgent,
    santaAccountDid,
    dmSender,
    new Set(ensureElfDids)
  );
  const subscription = new FirehoseSubscription(
    db,
    playerService,
    santaAccountDid
  );
  playerService.addListener(subscription.playersChanged.bind(subscription));

  await db
    .updateTable('player')
    .set({ admin: 1 })
    .where('did', 'in', ensureElfDids)
    .execute();

  const app = await build(
    { logger: true },
    {
      oauthSessionStore,
      returnTokenManager,
      authTokenManager,
      playerService,
      db,
      atOauthClient,
      fullScopeHandles: new Set(
        [santaHandle, robotHandle].map((s) => s.toLowerCase())
      ),
      santaAgent,
      robotAgent,
      settingsChanged: async (settings) =>
        Promise.all([
          playerService.settingsChanged(settings),
          nudgeSender.settingsChanged(settings),
          dmSender.settingsChanged(settings),
        ]),
      didResolver,
    }
  );

  app.listen({ port: 3000 }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });

  subscription.start();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
