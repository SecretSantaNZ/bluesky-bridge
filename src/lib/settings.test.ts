import { describe, expect, it } from 'vitest';
import { createDb, migrateToLatest } from './database/index.js';
import { loadSettings } from './settings.js';

const setupDb = async (overrides: {
  signups_open: 0 | 1;
  hashtag?: string;
}) => {
  const db = createDb();
  await migrateToLatest(db);

  // migrateToLatest seeds a single settings row, update it with the values
  // under test
  await db.updateTable('settings').set(overrides).execute();

  return db;
};

describe('loadSettings', () => {
  it('loads settings and converts signups_open 1 to boolean', async () => {
    const db = await setupDb({ signups_open: 1, hashtag: '#secretsanta' });

    const result = await loadSettings(db);

    expect(result.signups_open).toBe(true);
    expect(result.hashtag).toBe('#secretsanta');
    expect('id' in result).toBe(false);
  });

  it('converts signups_open 0 to false', async () => {
    const db = await setupDb({ signups_open: 0 });

    const result = await loadSettings(db);

    expect(result.signups_open).toBe(false);
  });
});
