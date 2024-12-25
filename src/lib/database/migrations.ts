import {
  sql,
  type Kysely,
  type Migration,
  type MigrationProvider,
} from 'kysely';
import {
  initialCarriers,
  initialMessages,
  initialNudgeGreetings,
  initialNudgeSignoffs,
} from './initialMessages.js';
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
      .addColumn('avatar_url', 'varchar')
      .addColumn('profile_complete', 'int2', (col) => col.notNull())
      .addColumn('signup_complete', 'int2', (col) => col.notNull())
      .addColumn('following_santa_uri', 'varchar')
      .addColumn('santa_following_uri', 'varchar')
      .addColumn('address', 'varchar')
      .addColumn('address_review_required', 'varchar')
      .addColumn('delivery_instructions', 'varchar')
      .addColumn('game_mode', 'varchar', (col) =>
        col.check(
          sql`game_mode is null or game_mode in ('Regular','Super Santa','Santa Only','Giftee Only')`
        )
      )
      .addColumn('max_giftees', 'integer', (col) => col.notNull())
      .addColumn('giftee_for_count', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('locked_giftee_for_count', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('giftee_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('opted_out', 'varchar')
      .addColumn('booted', 'varchar')
      .addColumn('booted_by', 'varchar')
      .execute();

    await db.schema
      .createTable('match')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('santa', 'integer', (col) => col.notNull())
      .addColumn('giftee', 'integer', (col) => col.notNull())
      .addColumn('deactivated', 'varchar')
      .addColumn('has_present', 'int2', (col) => col.notNull())
      .addColumn('invalid_player', 'int2', (col) => col.notNull())
      .addColumn('match_status', 'varchar', (col) =>
        col.check(sql`match_status in ('draft','shared','locked')`)
      )
      .addColumn('dm_handle_status', 'varchar', (col) =>
        col
          .check(sql`dm_handle_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .addColumn('dm_address_status', 'varchar', (col) =>
        col
          .check(sql`dm_address_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .addColumn('nudge_count', 'integer', (col) => col.notNull())
      .addColumn('nudge_present_update_count', 'integer', (col) =>
        col.notNull()
      )
      .addColumn('tracking_count', 'integer', (col) => col.notNull())
      .addColumn('tracking_missing_count', 'integer', (col) => col.notNull())
      .addForeignKeyConstraint('fk_match_santa', ['santa'], 'player', ['id'])
      .addForeignKeyConstraint('fk_match_giftee', ['giftee'], 'player', ['id'])
      .execute();

    await sql`
      create trigger match_on_insert after insert on match for each row when new.deactivated is null begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftees_count = giftees_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_deactivated after update of deactivated on match for each row when old.deactivated is null and new.deactivated is not null begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftees_count = giftees_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_reactivated after update of deactivated on match for each row when old.deactivated is not null and new.deactivated is null begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftees_count = giftees_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_locked after update of match_status on match for each row when old.match_status <> 'locked' and new.match_status = 'locked' and old.deactivated is null and new.deactivated is null begin
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_unlocked after update of match_status on match for each row when old.match_status = 'locked' and new.match_status <> 'locked' and old.deactivated is null and new.deactivated is null begin
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = new.giftee;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_delete after delete on match for each row when old.deactivated is null begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftees_count = giftees_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await db.schema
      .createTable('nudge_type')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('name', 'varchar', (col) => col.notNull().unique())
      .addColumn('order_index', 'integer', (col) => col.notNull().unique())
      .execute();

    await db.schema
      .createTable('nudge_greeting')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('text', 'varchar', (col) => col.notNull().unique())
      .execute();

    await db.schema
      .createTable('nudge_type_greeting')
      .addColumn('nudge_type', 'integer', (col) => col.notNull())
      .addColumn('greeting', 'integer', (col) => col.notNull())
      .addPrimaryKeyConstraint('pk_nudge_type_greeting', [
        'nudge_type',
        'greeting',
      ])
      .addForeignKeyConstraint(
        'fk_nudge_type_greeting_greeting',
        ['greeting'],
        'nudge_greeting',
        ['id']
      )
      .addForeignKeyConstraint(
        'fk_nudge_type_greeting_type',
        ['nudge_type'],
        'nudge_type',
        ['id']
      )
      .execute();

    await db.schema
      .createTable('nudge_signoff')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('text', 'varchar', (col) => col.notNull().unique())
      .execute();

    await db.schema
      .createTable('nudge_type_signoff')
      .addColumn('nudge_type', 'integer', (col) => col.notNull())
      .addColumn('signoff', 'integer', (col) => col.notNull())
      .addPrimaryKeyConstraint('pk_nudge_type_signoff', [
        'nudge_type',
        'signoff',
      ])
      .addForeignKeyConstraint(
        'fk_nudge_type_signoff_signoff',
        ['signoff'],
        'nudge_signoff',
        ['id']
      )
      .addForeignKeyConstraint(
        'fk_nudge_type_signoff_type',
        ['nudge_type'],
        'nudge_type',
        ['id']
      )
      .execute();

    await db.schema
      .createTable('nudge')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('nudge_type', 'integer', (col) => col.notNull())
      .addColumn('nudge_greeting', 'integer', (col) => col.notNull())
      .addColumn('nudge_signoff', 'integer', (col) => col.notNull())
      .addColumn('match', 'integer', (col) => col.notNull())
      .addColumn('nudge_status', 'varchar', (col) =>
        col
          .check(sql`nudge_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .addColumn('created_by', 'integer', (col) => col.notNull())
      .addForeignKeyConstraint(
        'fk_nudge_nudge_type',
        ['nudge_type'],
        'nudge_type',
        ['id']
      )
      .addForeignKeyConstraint(
        'fk_nudge_nudge_greeting',
        ['nudge_greeting'],
        'nudge_greeting',
        ['id']
      )
      .addForeignKeyConstraint(
        'fk_nudge_nudge_signoff',
        ['nudge_signoff'],
        'nudge_signoff',
        ['id']
      )
      .addForeignKeyConstraint('fk_nudge_match', ['match'], 'match', ['id'])
      .execute();

    await sql`
      create trigger nudge_on_insert after insert on nudge for each row begin
        update match set nudge_count = nudge_count + 1 where id = new.match;
        update match set nudge_present_update_count = nudge_present_update_count + 1 where id = new.match and new.nudge_type = (select id from nudge_type where name = 'Present Update');
      end;
    `.execute(db);

    await sql`
      create trigger nudge_on_delete after delete on nudge for each row begin
        update match set nudge_count = nudge_count - 1 where id = old.match;
        update match set nudge_present_update_count = nudge_present_update_count - 1 where id = old.match and old.nudge_type = (select id from nudge_type where name = 'Present Update');
      end;
    `.execute(db);

    await db.schema
      .createTable('carrier')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('text', 'varchar', (col) => col.notNull().unique())
      .execute();

    await db.schema
      .createTable('tracking')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('carrier', 'integer', (col) => col.notNull())
      .addColumn('shipped_date', 'varchar', (col) => col.notNull())
      .addColumn('tracking_number', 'varchar', (col) => col.notNull())
      .addColumn('giftwrap_status', 'int2', (col) => col.notNull())
      .addColumn('missing', 'varchar')
      .addColumn('match', 'integer', (col) => col.notNull())
      .addColumn('tracking_status', 'varchar', (col) =>
        col
          .check(sql`tracking_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .addColumn('created_by', 'integer', (col) => col.notNull())
      .addForeignKeyConstraint('fk_tracking_carrier', ['carrier'], 'carrier', [
        'id',
      ])
      .addForeignKeyConstraint('fk_tracking_match', ['match'], 'match', ['id'])
      .execute();

    await sql`
      create trigger tracking_on_insert after insert on tracking for each row begin
        update match set tracking_count = tracking_count + 1 where id = new.match;
      end;
    `.execute(db);

    await sql`
      create trigger tracking_on_missing after update of missing on tracking for each row when old.missing is null and new.missing is not null begin
        update match set tracking_missing_count = tracking_missing_count + 1 where id = new.match;
      end;
    `.execute(db);

    await sql`
      create trigger tracking_on_arrived after update of missing on tracking for each row when old.missing is not null and new.missing is null begin
        update match set tracking_missing_count = tracking_missing_count - 1 where id = new.match;
      end;
    `.execute(db);

    await sql`
      create trigger tracking_on_delete after delete on tracking for each row begin
        update match set tracking_count = tracking_count - 1 where id = old.match;
        update match set tracking_missing_count = tracking_missing_count - 1 where id = old.match and old.missing is not null;
      end;
    `.execute(db);

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

    await (db as Database)
      .insertInto('nudge_type')
      .values([
        { id: 1, name: 'Hint', order_index: 1 },
        { id: 2, name: 'Arrival', order_index: 2 },
        { id: 3, name: 'Present Update', order_index: 3 },
        { id: 4, name: 'Opening', order_index: 4 },
      ])
      .execute();
    const nudgeTypeIds: Record<string, number> = {
      Hint: 1,
      Arrival: 2,
      'Present Update': 3,
      Opening: 4,
    };
    for (const greeting of initialNudgeGreetings) {
      const greetingResult = await (db as Database)
        .insertInto('nudge_greeting')
        .values({
          text: greeting.text,
        })
        .executeTakeFirst();
      for (const nudgeType of greeting.nudge_type) {
        await (db as Database)
          .insertInto('nudge_type_greeting')
          .values({
            greeting: Number(greetingResult.insertId!),
            nudge_type: nudgeTypeIds[nudgeType]!,
          })
          .execute();
      }
    }
    for (const signoff of initialNudgeSignoffs) {
      const signoffResult = await (db as Database)
        .insertInto('nudge_signoff')
        .values({
          text: signoff.text,
        })
        .executeTakeFirst();
      for (const nudgeType of signoff.nudge_type) {
        await (db as Database)
          .insertInto('nudge_type_signoff')
          .values({
            signoff: Number(signoffResult.insertId!),
            nudge_type: nudgeTypeIds[nudgeType]!,
          })
          .execute();
      }
    }
    for (const carrier of initialCarriers) {
      await (db as Database)
        .insertInto('carrier')
        .values({
          text: carrier,
        })
        .execute();
    }

    await (db as Database)
      .insertInto('settings')
      .values({
        id: 0,
        signups_open: 1,
        matches_sent_date: '2025-04-17',
        send_by_date: '2025-05-01',
        opening_date: '2025-05-14',
        hashtag: '#SecretSantaNZ',
        elf_list:
          '@ninjakitty.bsky.social, @eloquentsonia.bsky.social, @larissacomments.bsky.social and @witchnwords.bsky.social',
      })
      .execute();
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
