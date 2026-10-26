import path from 'path';
import dotenv from 'dotenv';

import { build } from './app.js';
import { Bridge } from './bridge.js';
import { createDb, migrateToLatest } from './lib/database/index.js';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    `${process.env.CREDENTIALS_DIRECTORY}/secretsanta-creds`,
    path.resolve(process.cwd(), '.env.client'),
  ],
});

const main = async () => {
  const db = createDb();
  await migrateToLatest(db);

  const bridge = await Bridge.build(
    {
      tokenIssuer: process.env.TOKEN_ISSUER as string,
      santaHandle: process.env.SANTA_BLUESKY_HANDLE as string,
      robotHandle: process.env.ROBOT_BLUESKY_HANDLE as string,
      santaMastodonHandle: process.env.SANTA_MASTODON_HANDLE as string,
      ensureElfHandles: (process.env.ENSURE_ELF_HANDLES ?? '')
        .split(',')
        .filter((handle) => handle !== ''),
      basePath: process.env.PUBLIC_BASE_URL as string,
    },
    { db }
  );

  await bridge.init();

  const app = await build({ logger: true }, bridge.blueskyBridge);

  app.listen({ port: 3000 }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });

  bridge.start();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
