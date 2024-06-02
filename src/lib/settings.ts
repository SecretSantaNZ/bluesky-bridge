import type { Database } from './database/index.js';
import type { Settings as DbSettings } from './database/schema.js';

export type Settings = Omit<DbSettings, 'id' | 'signups_open'> & {
  signups_open: boolean;
};

export const saveSettings = async (db: Database, settings: Settings) => {
  const body = {
    ...settings,
    signups_open: settings.signups_open ? 1 : 0,
  };
  await db
    .insertInto('settings')
    .values({ ...body, id: 1 })
    .onConflict((cf) => cf.doUpdateSet(body))
    .execute();
};

export const loadSettings = async (db: Database): Promise<Settings> => {
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    id,
    signups_open,
    ...rest
  } = await db
    .selectFrom('settings')
    .selectAll()
    .limit(1)
    .executeTakeFirstOrThrow();

  return { ...rest, signups_open: signups_open === 1 };
};
