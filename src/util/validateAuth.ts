import type fastify from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import type { TokenManager } from '../lib/TokenManager.js';

export const validateAuth = (
  tokenManager: (app: fastify.FastifyInstance['blueskyBridge']) => TokenManager,
  cookieName?: string
): fastify.onRequestAbortAsyncHookHandler => {
  return async function validateAuth(request) {
    let { authorization } = request.headers;
    if (cookieName != null) {
      authorization = request.cookies[cookieName];
    } else {
      authorization = authorization?.replace(/^Bearer\s+/, '');
    }
    if (!authorization) {
      throw new UnauthorizedError('No Token');
    }
    try {
      const result = await tokenManager(this.blueskyBridge).validateToken(
        authorization
      );
      request.tokenSubject = result.subject;
    } catch (e) {
      const error = e as Error;
      throw new UnauthorizedError(error.message);
    }
  };
};
