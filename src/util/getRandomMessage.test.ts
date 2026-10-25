import { describe, expect, it } from 'vitest';
import { InternalServerError } from 'http-errors-enhanced';
import { getRandomMessage } from './getRandomMessage.js';
import { createDb, migrateToLatest } from '../lib/database/index.js';

describe('getRandomMessage', () => {
  it('returns a message with substitutions applied', async () => {
    const db = createDb();
    await migrateToLatest(db);

    await db
      .insertInto('message')
      .values({ message_type: 'greeting', message: 'Hello $name$!' })
      .execute();

    const result = await getRandomMessage(db, 'greeting', { name: 'Alice' });
    expect(result).toBe('Hello Alice!');
  });

  it('throws InternalServerError if no messages found', async () => {
    const db = createDb();
    await migrateToLatest(db);

    await expect(getRandomMessage(db, 'missing', {})).rejects.toBeInstanceOf(
      InternalServerError
    );
  });

  it('applies multiple substitutions', async () => {
    const db = createDb();
    await migrateToLatest(db);

    await db
      .insertInto('message')
      .values({
        message_type: 'substitutions',
        message: '$santa$ gives to $giftee$',
      })
      .execute();

    const result = await getRandomMessage(db, 'substitutions', {
      santa: 'Bob',
      giftee: 'Carol',
    });
    expect(result).toBe('Bob gives to Carol');
  });
});
