import SqliteDb from 'better-sqlite3';
import { Kysely, Migrator, SqliteDialect } from 'kysely';
import type { DatabaseSchema } from './schema.js';
import { migrationProvider } from './migrations.js';

export type Database = Kysely<DatabaseSchema>;

export const createDb = (): Database => {
  const location = process.env.SQLITE_LOCATION ?? ':memory:';
  const database = new SqliteDb(location);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = true');
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database,
    }),
  });
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};

export * from './tracking.js';
export * from './match.js';
export * from './nudge.js';
export * from './loadPlayersWhoCanHaveMoreGifees.js';
