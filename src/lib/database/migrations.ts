import {
  sql,
  type Kysely,
  type Migration,
  type MigrationProvider,
} from 'kysely';

const migrations: Record<string, Migration> = {};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('jwt_mac_key')
      .addColumn('kid', 'varchar', (col) => col.primaryKey())
      .addColumn('audience', 'varchar', (col) => col.notNull())
      .addColumn('key_bytes', 'blob', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('auth_request')
      .addColumn('post_key', 'varchar', (col) => col.notNull().unique())
      .addColumn('auth_code', 'varchar', (col) => col.notNull().unique())
      .addColumn('auth_state', 'varchar', (col) =>
        col.notNull().check(sql`auth_state in ('pending', 'authenticated')`)
      )
      .addColumn('client_id', 'varchar', (col) => col.notNull())
      .addColumn('redirect_uri', 'varchar', (col) => col.notNull())
      .addColumn('scope', 'varchar')
      .addColumn('state', 'varchar', (col) => col.notNull())
      .addColumn('user_did', 'varchar', (col) => col.notNull())
      .addColumn('started_at', 'varchar', (col) => col.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('auth_request').execute();
    await db.schema.dropTable('jwt_mac_key').execute();
  },
};
