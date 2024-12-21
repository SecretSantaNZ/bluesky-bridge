import {
  sql,
  type Kysely,
  type Migration,
  type MigrationProvider,
} from 'kysely';
import { initialMessages } from './initialMessages.js';
import type { Database } from './index.js';
import type { Message } from './schema.js';

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
      .createTable('jwk_key')
      .addColumn('kid', 'varchar', (col) => col.primaryKey())
      .addColumn('jwk_json', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('at_oauth_state')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('data', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('at_oauth_session')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('data', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('auth_request')
      .addColumn('request_id', 'varchar', (col) => col.primaryKey())
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

    await db.schema
      .createTable('player')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('did', 'varchar', (col) => col.notNull().unique())
      .addColumn('handle', 'varchar', (col) => col.notNull())
      .addColumn('profile_complete', 'int2', (col) => col.notNull())
      .addColumn('signup_complete', 'int2', (col) => col.notNull())
      .addColumn('following_santa_uri', 'varchar')
      .addColumn('santa_following_uri', 'varchar')
      .addColumn('address', 'varchar')
      .addColumn('address_review_required', 'int2', (col) => col.notNull())
      .addColumn('delivery_instructions', 'varchar')
      .addColumn('game_mode', 'varchar', (col) =>
        col.check(
          sql`game_mode is null or game_mode in ('Regular','Super Santa','Santa Only','Giftee Only')`
        )
      )
      .addColumn('max_giftees', 'integer', (col) => col.notNull())
      .addColumn('opted_out', 'int2', (col) => col.notNull())
      .addColumn('booted', 'int2', (col) => col.notNull())
      .addColumn('booted_by', 'varchar')
      .addColumn('booted_at', 'varchar')
      .execute();

    await db.schema
      .createTable('settings')
      .addColumn('id', 'numeric', (col) => col.primaryKey())
      .addColumn('signups_open', 'int2', (col) => col.notNull())
      .addColumn('matches_sent_date', 'varchar', (col) => col.notNull())
      .addColumn('send_by_date', 'varchar', (col) => col.notNull())
      .addColumn('opening_date', 'varchar', (col) => col.notNull())
      .addColumn('hashtag', 'varchar', (col) => col.notNull())
      .addColumn('elf_list', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('message')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('message_type', 'varchar', (col) => col.notNull())
      .addColumn('message', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('idx_message_type')
      .on('message')
      .column('message_type')
      .execute();

    for (const [message_type, messages] of Object.entries(initialMessages)) {
      await (db as Database)
        .insertInto('message')
        .values(
          messages.map((message) => ({ message_type, message }) as Message)
        )
        .execute();
    }
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('idx_message_type').execute();
    await db.schema.dropTable('message').execute();
    await db.schema.dropTable('settings').execute();
    await db.schema.dropTable('player').execute();
    await db.schema.dropTable('auth_request').execute();
    await db.schema.dropTable('jwt_mac_key').execute();
  },
};
