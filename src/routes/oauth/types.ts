import type { FastifyPluginOptions } from 'fastify';
import type { OauthSessionStore } from '../../lib/oauth.js';

export type OauthPluginOptions = FastifyPluginOptions & {
  oauthSessionStore: OauthSessionStore;
};
