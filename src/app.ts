import newrelic from 'newrelic';
import path from 'node:path';
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
import fastifyStatic from '@fastify/static';
import ejs from 'ejs';
import nunjucks from 'nunjucks';

import type { TokenManager } from './lib/TokenManager.js';

import { view } from './routes/view/index.js';
import { publicContent } from './routes/public/index.js';
import { player } from './routes/player/index.js';
import type { Database } from './lib/database/index.js';
import type { PlayerService } from './lib/PlayerService.js';
import type { NodeOAuthClient } from '@atproto/oauth-client-node';
import { at_oauth } from './routes/at_oauth/index.js';
import type { DidResolver } from '@atproto/identity';
import type { Agent } from '@atproto/api';
import { match } from './routes/match/index.js';
import { nudge } from './routes/nudge/index.js';
import { xrpc } from './routes/xrpc/index.js';
import { mastodon } from './routes/mastodon/index.js';
import type { SelectedSettings } from './lib/settings.js';

declare module 'fastify' {
  export interface FastifyInstance {
    blueskyBridge: {
      returnTokenManager: TokenManager<{ returnUrl: string }>;
      authTokenManager: TokenManager<{
        csrfToken: string;
        startedAt: string;
        handle: string;
        admin?: true;
      }>;
      playerService: PlayerService;
      db: Database;
      atOauthClient: NodeOAuthClient;
      fullScopeHandles: ReadonlySet<string>;
      santaAccountDid: string;
      santaAgent: () => Promise<Agent>;
      robotAgent: () => Promise<Agent>;
      settingsChanged: (
        settings: Omit<
          SelectedSettings,
          | 'id'
          | 'current_game_badge_id'
          | 'sent_present_badge_id'
          | 'super_santa_badge_id'
        >
      ) => Promise<unknown>;
      didResolver: DidResolver;
    };
  }

  export interface FastifyRequest {
    tokenSubject?: string;
    tokenData?: Record<string, unknown>;
    playerDid?: string;
    adminMode?: boolean;
  }
  export interface FastifyReply {
    locals?: Record<string, unknown>;
    nunjucks: FastifyReply['view'];
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
    defaultContext: {
      newrelic,
    },
  });
  await app.register(fastifyView, {
    engine: {
      nunjucks,
    },
    root: path.join(process.cwd(), 'views'),
    defaultContext: {
      newrelic,
    },
    viewExt: 'njk',
    propertyName: 'nunjucks',
    options: {
      noCache: process.env.NODE_ENV !== 'production',
    },
  });

  await app.register(fastifyStatic, {
    prefix: '/public/',
    root: path.join(process.cwd(), 'public'),
  });

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(player, { prefix: '/player' });
  await app.register(match, { prefix: '/match' });
  await app.register(nudge, { prefix: '/nudge' });
  await app.register(at_oauth);
  await app.register(view);
  await app.register(xrpc);
  await app.register(publicContent);
  await app.register(mastodon, { prefix: '/mastodon' });

  return app;
};
