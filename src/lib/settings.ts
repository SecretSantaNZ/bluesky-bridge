import type { SelectType } from 'kysely';
import type { Database } from './database/index.js';
import type { Settings as DbSettings } from './database/schema.js';

export type SelectedSettings = {
  [K in keyof DbSettings]: SelectType<DbSettings[K]>;
};

export type Settings = Omit<SelectedSettings, 'id' | 'signups_open'> & {
  signups_open: boolean;
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
