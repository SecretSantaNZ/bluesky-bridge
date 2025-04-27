import type fastify from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import type { TokenManager } from '../lib/TokenManager.js';

export const validateAuth = <D extends Record<string, unknown>>(
  tokenManager: (
    app: fastify.FastifyInstance['blueskyBridge']
  ) => TokenManager<D>,
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
      request.tokenData = result.data;
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        throw e;
      }
      const error = e as Error;
      throw new UnauthorizedError(error.message);
    }
  };
};
