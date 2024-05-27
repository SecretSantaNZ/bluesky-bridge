import SqliteDb from 'better-sqlite3';
import { Kysely, Migrator, SqliteDialect } from 'kysely';
import type { DatabaseSchema } from './schema.js';
import { migrationProvider } from './migrations.js';

export type Database = Kysely<DatabaseSchema>;

export const createDb = (): Database => {
  const location = process.env.SQLITE_LOCATION ?? ':memory:';
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
  });
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};
