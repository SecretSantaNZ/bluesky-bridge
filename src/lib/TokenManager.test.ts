import { describe, expect, it, beforeEach } from 'vitest';
import { UnauthorizedError } from 'http-errors-enhanced';
import { TokenManager } from './TokenManager.js';
import { createDb, migrateToLatest } from './database/index.js';
import type { Database } from './database/index.js';

describe('TokenManager', () => {
  let db: Database;

  beforeEach(async () => {
    db = createDb();
    await migrateToLatest(db);
  });

  it('initializes and generates a token', async () => {
    const tm = new TokenManager<{ role: string }>(
      db,
      'test-issuer',
      'test-audience',
      '1h'
    );
    await tm.initialize();
    const token = await tm.generateToken('did:plc:123', { role: 'admin' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('validates a generated token and returns subject/data/expiresAt', async () => {
    const tm = new TokenManager<{ role: string }>(
      db,
      'test-issuer',
      'test-audience',
      '1h'
    );
    await tm.initialize();
    const token = await tm.generateToken('did:plc:123', { role: 'admin' });
    const result = await tm.validateToken(token);
    expect(result.subject).toBe('did:plc:123');
    expect(result.data.role).toBe('admin');
    expect(typeof result.expiresAt).toBe('number');
  });

  it('throws UnauthorizedError for invalid token', async () => {
    const tm = new TokenManager(db, 'test-issuer', 'test-audience', '1h');
    await tm.initialize();
    await expect(tm.validateToken('not-a-token')).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });
});
