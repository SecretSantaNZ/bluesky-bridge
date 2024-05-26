import path from 'path';
import dotenv from 'dotenv';

import { build } from './app.js';
import { Subscription } from './subscription.js';
import { OauthSessionStore } from './lib/oauth.js';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    `${process.env.CREDENTIALS_DIRECTORY}/bluesky-bridge-creds`,
  ],
});

const main = async () => {
  const oauthSessionStore = new OauthSessionStore();
  oauthSessionStore.registerClient({
    client_id: process.env.OAUTH_CLIENT_ID as string,
    client_secret: process.env.OAUTH_CLIENT_SECRET as string,
    redirectUris: new Set([process.env.OAUTH_REDIRECT_URI as string]),
  });

  const subscription = new Subscription();
  subscription.onPostMatching(
    /!SecretSantaNZ let me in\s*([^\s]+)/i,
    (post, matches) => {
      oauthSessionStore.keyPostSeen(matches[1] as string, post.author);
    }
  );

  const app = await build({ logger: true, oauthSessionStore });

  subscription.run(3000);

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
