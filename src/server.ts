import path from 'path';
import dotenv from 'dotenv';
import { DidResolver, MemoryCache } from '@atproto/identity';

import { build } from './app.js';
// import { Subscription } from './subscription.js';
import { OauthSessionStore } from './lib/oauth.js';
import { TokenManager } from './lib/TokenManager.js';
import { createDb, migrateToLatest } from './lib/database/index.js';
import { buildAtpClient } from './bluesky.js';
import { PlayerService } from './lib/PlayerService.js';
import { initAtLoginClient } from './lib/initAtLoginClient.js';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    `${process.env.CREDENTIALS_DIRECTORY}/bluesky-bridge-creds`,
  ],
});

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
  const loginTokenManager = new TokenManager<{ returnUrl: string }>(
    db,
    tokenIssuer,
    `${tokenIssuer}/oauth/login`,
    '5 minutes'
  );
  const authTokenManager = new TokenManager<Record<string, unknown>>(
    db,
    tokenIssuer,
    `${tokenIssuer}/endpoints`,
    '1 day'
  );

  const [atOauthClient] = await Promise.all([
    initAtLoginClient({
      database: db,
      basePath: process.env.PUBLIC_BASE_URL as string,
    }),
    loginTokenManager.initialize(),
    authTokenManager.initialize(),
  ]);
  const santaHandle = process.env.SANTA_BLUESKY_HANDLE as string;
  const robotHandle = process.env.ROBOT_BLUESKY_HANDLE as string;
  const [[santaAgent, santaAccountDid], [robotAgent]] = await Promise.all([
    buildAtpClient(atOauthClient, santaHandle),
    buildAtpClient(atOauthClient, robotHandle),
  ]);
  const didResolver = new DidResolver({
    didCache: new MemoryCache(),
    plcUrl: 'https://plc.directory',
    timeout: 3000,
  });

  const playerService = new PlayerService(db, santaAgent, santaAccountDid);
  // const subscription = new Subscription(playerService);
  // subscription.onPostMatching(
  //   /!SecretSantaNZ let me in\s*([^\s]+)/i,
  //   (post, matches) => {
  //     oauthSessionStore.keyPostSeen(matches[1] as string, post.author);
  //   }
  // );

  const app = await build(
    { logger: true },
    {
      oauthSessionStore,
      loginTokenManager,
      authTokenManager,
      playerService,
      db,
      atOauthClient,
      fullScopeHandles: new Set(
        [santaHandle, robotHandle].map((s) => s.toLowerCase())
      ),
      santaAgent,
      robotAgent,
      didResolver,
    }
  );

  // subscription.run(3000);

  app.listen({ port: 3000 }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
