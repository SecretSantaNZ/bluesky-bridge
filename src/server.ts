import path from 'path';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { build } from './app.js';
import { Subscription } from './subscription.js';
import { OauthSessionStore } from './lib/oauth.js';
import { LoginTokenManager } from './lib/LoginTokenManager.js';

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

  const tokenIssuer = process.env.TOKEN_ISSUER as string;
  const loginTokenManager = new LoginTokenManager(
    tokenIssuer,
    `${tokenIssuer}/oauth/login`
  );
  // TODO, pull and rotate from database so things don't break on restart
  loginTokenManager.setKey(uuidv4(), randomBytes(32));

  const subscription = new Subscription();
  subscription.onPostMatching(
    /!SecretSantaNZ let me in\s*([^\s]+)/i,
    (post, matches) => {
      oauthSessionStore.keyPostSeen(matches[1] as string, post.author);
    }
  );

  const app = await build(
    { logger: true },
    { oauthSessionStore, loginTokenManager }
  );

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
