import type { Database } from './index.js';

export function queryFullNudge(db: Database) {
  return db
    .selectFrom('nudge')
    .innerJoin('match', 'match.id', 'nudge.match')
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .innerJoin('nudge_type', 'nudge_type.id', 'nudge.nudge_type')
    .select([
      'santa.did as santa_did',
      'santa.handle as santa_handle',
      'santa.avatar_url as santa_avatar_url',
      'santa.note_count as santa_note_count',
      'giftee.did as giftee_did',
      'giftee.handle as giftee_handle',
      'giftee.avatar_url as giftee_avatar_url',
      'giftee.note_count as giftee_note_count',
      'nudge_type.name as nudge_type',
      'nudge.id as nudge_id',
      'nudge.created_at',
      'nudge_status',
    ]);
}

export async function loadNudgeOptions(db: Database) {
  const [nudgeTypesFromDb, greetings, signoffs] = await Promise.all([
    db
      .selectFrom('nudge_type')
      .selectAll()
      .orderBy('order_index', 'asc')
      .execute(),
    db
      .selectFrom('nudge_type_greeting')
      .innerJoin(
        'nudge_greeting',
        'nudge_greeting.id',
        'nudge_type_greeting.greeting'
      )
      .selectAll()
      .orderBy('nudge_greeting.id', 'asc')
      .execute(),
    db
      .selectFrom('nudge_type_signoff')
      .innerJoin(
        'nudge_signoff',
        'nudge_signoff.id',
        'nudge_type_signoff.signoff'
      )
      .selectAll()
      .orderBy('nudge_signoff.id', 'asc')
      .execute(),
  ]);

  const nudgeGreetings: Record<
    string,
    Array<{ id: number; text: string }>
  > = {};
  const nudgeSignoffs: Record<string, Array<{ id: number; text: string }>> = {};
  const nudgeTypes = nudgeTypesFromDb.map((nudgeType) => ({
    id: String(nudgeType.id),
    text: nudgeType.name,
  }));
  nudgeTypesFromDb.forEach((nudgeType) => {
    nudgeGreetings[String(nudgeType.id)] = greetings
      .filter((row) => row.nudge_type === nudgeType.id)
      .map((row) => ({
        id: row.id,
        text: row.text,
      }));
    nudgeSignoffs[String(nudgeType.id)] = signoffs
      .filter((row) => row.nudge_type === nudgeType.id)
      .map((row) => ({
        id: row.id,
        text: row.text,
      }));
  });

  return {
    nudgeTypes,
    nudgeGreetings,
    nudgeSignoffs,
  };
}
