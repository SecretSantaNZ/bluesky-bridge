import type { FastifyPluginOptions } from 'fastify';
import type { OauthSessionStore } from '../../lib/oauth.js';
import type { LoginTokenManager } from '../../lib/LoginTokenManager.js';

export type OauthPluginOptions = FastifyPluginOptions & {
  oauthSessionStore: OauthSessionStore;
  loginTokenManager: LoginTokenManager;
};
