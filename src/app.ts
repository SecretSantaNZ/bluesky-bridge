import type * as http from 'http';
import fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import fastifyHttpErrorsEnhanced from 'fastify-http-errors-enhanced';
import fastifyFormBody from '@fastify/formbody';
import fastifyView from '@fastify/view';
import fastifyCookie from '@fastify/cookie';
import ejs from 'ejs';
import path from 'path';

import type { OauthSessionStore } from './lib/oauth.js';
import type { TokenManager } from './lib/TokenManager.js';

import { action } from './routes/action/index.js';
import { sync } from './routes/sync/index.js';
import { oauth } from './routes/oauth/index.js';
import { bsky } from './routes/bsky/index.js';
import { player } from './routes/player/index.js';
import type { Database } from './lib/database/index.js';
import type { PlayerService } from './lib/PlayerService.js';
import type { NodeOAuthClient } from '@atproto/oauth-client-node';
import { at_oauth } from './routes/at_oauth/index.js';
import type { DidResolver } from '@atproto/identity';
import type { Agent } from '@atproto/api';

declare module 'fastify' {
  export interface FastifyInstance {
    blueskyBridge: {
      oauthSessionStore: OauthSessionStore;
      loginTokenManager: TokenManager;
      authTokenManager: TokenManager;
      playerService: PlayerService;
      db: Database;
      atOauthClient: NodeOAuthClient;
      fullScopeHandles: ReadonlySet<string>;
      santaAgent: () => Promise<Agent>;
      robotAgent: () => Promise<Agent>;
      didResolver: DidResolver;
    };
  }

  export interface FastifyRequest {
    tokenSubject?: string;
  }
}

export const build = async (
  opts: fastify.FastifyHttpOptions<http.Server>,
  blueskyBridge: FastifyInstance['blueskyBridge']
) => {
  const app = fastify(opts);
  app.decorate('blueskyBridge', blueskyBridge);
  app.decorateRequest('tokenSubject');

  await app.register(fastifyCookie);
  await app.register(fastifyFormBody);
  await app.register(fastifyHttpErrorsEnhanced);
  await app.register(fastifyView, {
    engine: {
      ejs,
    },
    root: path.join(process.cwd(), 'views'),
  });

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(action, { prefix: '/action' });
  await app.register(sync, { prefix: '/sync' });
  await app.register(oauth, { prefix: '/oauth' });
  await app.register(bsky, { prefix: '/bsky' });
  await app.register(player, { prefix: '/player' });
  await app.register(at_oauth);

  return app;
};
