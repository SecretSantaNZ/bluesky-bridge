import type { Database } from './index.js';

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
