import { describe, expect, it, vi } from 'vitest';
import type fastify from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import type { TokenManager } from '../lib/TokenManager.js';
import { validateAuth } from './validateAuth.js';

type TokenManagerFactory<D extends Record<string, unknown>> = (
  app: fastify.FastifyInstance['blueskyBridge']
) => TokenManager<D>;

describe('validateAuth', () => {
  it('reads token from Authorization header with Bearer prefix', async () => {
    const validateToken = vi.fn().mockResolvedValue({
      subject: 'did:plc:123',
      data: { role: 'user' },
    });
    const tokenManager: TokenManagerFactory<{ role: string }> = vi
      .fn()
      .mockReturnValue({ validateToken });

    const handler = validateAuth(tokenManager);

    const request = {
      headers: { authorization: 'Bearer test-token' },
      cookies: {},
    } as fastify.FastifyRequest;
    const context = {
      blueskyBridge: {},
    } as fastify.FastifyInstance;

    await handler.call(context, request);

    expect(validateToken).toHaveBeenCalledWith('test-token');
    expect(request.tokenSubject).toBe('did:plc:123');
    expect(request.tokenData).toEqual({ role: 'user' });
  });

  it('reads token from cookie when cookieName is provided', async () => {
    const validateToken = vi.fn().mockResolvedValue({
      subject: 'did:plc:456',
      data: {},
    });
    const tokenManager: TokenManagerFactory<Record<string, unknown>> = vi
      .fn()
      .mockReturnValue({ validateToken });

    const handler = validateAuth(tokenManager, 'session');

    const request = {
      headers: {},
      cookies: { session: 'cookie-token' },
    } as unknown as fastify.FastifyRequest;
    const context = {
      blueskyBridge: {},
    } as fastify.FastifyInstance;

    await handler.call(context, request);

    expect(validateToken).toHaveBeenCalledWith('cookie-token');
    expect(request.tokenSubject).toBe('did:plc:456');
  });

  it('throws UnauthorizedError if no token', async () => {
    const tokenManager: TokenManagerFactory<Record<string, unknown>> = vi.fn();

    const handler = validateAuth(tokenManager);

    const request = {
      headers: {},
      cookies: {},
    } as fastify.FastifyRequest;
    const context = {
      blueskyBridge: {},
    } as fastify.FastifyInstance;

    await expect(handler.call(context, request)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    await expect(handler.call(context, request)).rejects.toThrow('No Token');
  });

  it('rethrows UnauthorizedError unchanged', async () => {
    const validateToken = vi
      .fn()
      .mockRejectedValue(new UnauthorizedError('Bad Token'));
    const tokenManager: TokenManagerFactory<Record<string, unknown>> = vi
      .fn()
      .mockReturnValue({ validateToken });

    const handler = validateAuth(tokenManager);

    const request = {
      headers: { authorization: 'Bearer bad' },
      cookies: {},
    } as fastify.FastifyRequest;
    const context = {
      blueskyBridge: {},
    } as fastify.FastifyInstance;

    await expect(handler.call(context, request)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    await expect(handler.call(context, request)).rejects.toThrow('Bad Token');
  });

  it('wraps other errors as UnauthorizedError', async () => {
    const validateToken = vi.fn().mockRejectedValue(new Error('Invalid'));
    const tokenManager: TokenManagerFactory<Record<string, unknown>> = vi
      .fn()
      .mockReturnValue({ validateToken });

    const handler = validateAuth(tokenManager);

    const request = {
      headers: { authorization: 'Bearer bad' },
      cookies: {},
    } as fastify.FastifyRequest;
    const context = {
      blueskyBridge: {},
    } as fastify.FastifyInstance;

    await expect(handler.call(context, request)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    await expect(handler.call(context, request)).rejects.toThrow('Invalid');
  });
});
