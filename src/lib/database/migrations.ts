import {
  sql,
  type Kysely,
  type Migration,
  type MigrationProvider,
} from 'kysely';
import {
  initialCarriers,
  initialHintIdeas,
  initialMessages,
  initialNudgeGreetings,
  initialNudgeSignoffs,
} from './initialMessages.js';
import type { Database } from './index.js';
import { getLocation } from '../googlePlaces.js';

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
      .addColumn('admin', 'int2', (col) => col.notNull().defaultTo(0))
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
      .addColumn('giftee_count_status', 'varchar', (col) =>
        col
          .check(
            sql`giftee_count_status in ('can_have_more', 'full', 'too_many')`
          )
          .defaultTo('full')
      )
      .addColumn('opted_out', 'varchar')
      .addColumn('booted', 'varchar')
      .addColumn('booted_by', 'varchar')
      .addColumn('deactivated', 'int2', (col) => col.notNull().defaultTo(0))
      .execute();

    await db.schema
      .createIndex('idx_player_signup_complete_santa_following')
      .on('player')
      .columns(['signup_complete', 'santa_following_uri'])
      .execute();

    await db.schema
      .createIndex('idx_player_did')
      .on('player')
      .column('did')
      .execute();

    await db.schema
      .createIndex('idx_player_signup_complete_handle')
      .on('player')
      .columns(['signup_complete', 'handle'])
      .execute();

    await db.schema
      .createIndex('idx_player_deactivated_handle')
      .on('player')
      .columns(['deactivated', 'handle'])
      .execute();

    await sql`
      create trigger player_after_insert after insert on player for each row begin
        update player set profile_complete = 1 where id = new.id and new.address is not null and new.address <> '' and new.game_mode is not null;

        update player set giftee_count_status = 'can_have_more' where id = new.id and max_giftees is not null and giftee_count < max_giftees;
        update player set giftee_count_status = 'full' where id = new.id and max_giftees is not null and giftee_count = max_giftees;
        update player set giftee_count_status = 'too_many' where id = new.id and max_giftees is not null and giftee_count > max_giftees;
      end;
    `.execute(db);

    await sql`
      create trigger player_update_profile_complete after update of address, game_mode on player for each row begin
        update player set profile_complete = 1 where id = new.id and new.address is not null and new.address <> '' and new.game_mode is not null and old.profile_complete = 0;
        update player set profile_complete = 0 where id = new.id and not (new.address is not null and new.address <> '' and new.game_mode is not null) and old.profile_complete = 1;
      end;
    `.execute(db);

    await sql`
      create trigger player_update_signup_complete after update of profile_complete, following_santa_uri, opted_out, booted on player for each row begin
        update player set signup_complete = 1 where id = new.id and new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null and old.signup_complete = 0;
        update player set signup_complete = 0 where id = new.id and not (new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null) and old.signup_complete = 1;

        update player set deactivated = 0 where id = new.id and new.opted_out is null and new.booted is null and old.deactivated = 1;
        update player set deactivated = 1 where id = new.id and not (new.opted_out is null and new.booted is null) and old.deactivated = 0;
      end;
    `.execute(db);

    await sql`
      create trigger player_update_giftee_count_status after update of giftee_count, max_giftees on player for each row begin
        update player set giftee_count_status = 'can_have_more' where id = new.id and new.giftee_count < new.max_giftees;
        update player set giftee_count_status = 'full' where id = new.id and new.giftee_count = new.max_giftees;
        update player set giftee_count_status = 'too_many' where id = new.id and new.giftee_count > new.max_giftees;
      end;
    `.execute(db);

    await sql`
      create trigger player_update_deactivated_changed after update of deactivated on player for each row when new.deactivated <> old.deactivated begin
        update match
          set invalid_player = min(1, (select count(*) from player where player.deactivated AND (player.id = match.giftee or player.id = match.santa)))
          where santa = new.id or giftee = new.id;
      end;
    `.execute(db);

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

    await db.schema
      .createIndex('idx_match_santa')
      .on('match')
      .column('santa')
      .execute();

    await db.schema
      .createIndex('idx_match_giftee')
      .on('match')
      .column('giftee')
      .execute();

    await db.schema
      .createIndex('idx_match_invalid_player')
      .on('match')
      .column('invalid_player')
      .execute();

    await sql`
      create trigger match_on_insert after insert on match for each row when new.deactivated is null begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftee_count = giftee_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_deactivated after update of deactivated on match for each row when old.deactivated is null and new.deactivated is not null begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftee_count = giftee_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await sql`
      create trigger match_on_reactivated after update of deactivated on match for each row when old.deactivated is not null and new.deactivated is null begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftee_count = giftee_count + 1 where id = new.santa;
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
        update player set giftee_count = giftee_count - 1 where id = old.santa;
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
      .createIndex('idx_nudge_type_greeting_greeting')
      .on('nudge_type_greeting')
      .columns(['greeting', 'nudge_type'])
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
      .createIndex('idx_nudge_type_signoff_signoff')
      .on('nudge_type_signoff')
      .columns(['signoff', 'nudge_type'])
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

    await db.schema
      .createIndex('idx_tracking_match')
      .on('tracking')
      .column('match')
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
        .values(messages.map((message) => ({ message_type, message })))
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
      // @ts-expect-error the other columns do not get added until later
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

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('match')
      .addColumn('followup_action', 'varchar', (col) =>
        col.check(
          sql`followup_action is null or followup_action in ('super-assigned', 'sorted')`
        )
      )
      .execute();

    await db.schema
      .alterTable('match')
      .addColumn('contacted', 'varchar')
      .execute();

    await db.schema
      .alterTable('match')
      .addColumn('super_santa_match', 'int2', (col) =>
        col.notNull().defaultTo(0)
      )
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('match').dropColumn('followup_action').execute();
    await db.schema.alterTable('match').dropColumn('contacted').execute();
    await db.schema
      .alterTable('match')
      .dropColumn('super_santa_match')
      .execute();
  },
};

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('nudge')
      .addColumn('post_url', 'varchar')
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('nudge_rate', 'varchar', (col) =>
        col.notNull().defaultTo('10m')
      )
      .execute();
    await db.schema
      .alterTable('settings')
      .addColumn('dm_rate', 'varchar', (col) => col.notNull().defaultTo('1m'))
      .execute();
    await db.schema
      .alterTable('settings')
      .addColumn('auto_follow', 'int2', (col) => col.notNull().defaultTo(0))
      .execute();
    await db.schema
      .alterTable('settings')
      .addColumn('send_messages', 'int2', (col) => col.notNull().defaultTo(0))
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('nudge').dropColumn('post_url').execute();

    await db.schema.alterTable('settings').dropColumn('nudge_rate').execute();
    await db.schema.alterTable('settings').dropColumn('dm_rate').execute();
    await db.schema.alterTable('settings').dropColumn('auto_follow').execute();
    await db.schema
      .alterTable('settings')
      .dropColumn('send_messages')
      .execute();
  },
};

migrations['004'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('match')
      .renameColumn('dm_handle_status', 'dm_handle_status_old')
      .execute();
    await db.schema
      .alterTable('match')
      .renameColumn('dm_address_status', 'dm_address_status_old')
      .execute();
    await db.schema
      .alterTable('nudge')
      .renameColumn('nudge_status', 'nudge_status_old')
      .execute();
    await db.schema
      .alterTable('tracking')
      .renameColumn('tracking_status', 'tracking_status_old')
      .execute();

    await db.schema
      .alterTable('match')
      .addColumn('dm_handle_status', 'varchar', (col) =>
        col
          .check(
            sql`dm_handle_status in ('queued','sent') or dm_handle_status LIKE 'error: %'`
          )
          .defaultTo('queued')
      )
      .execute();
    await db.schema
      .alterTable('match')
      .addColumn('dm_address_status', 'varchar', (col) =>
        col
          .check(
            sql`dm_address_status in ('queued','sent') or dm_address_status LIKE 'error: %'`
          )
          .defaultTo('queued')
      )
      .execute();
    await db.schema
      .alterTable('nudge')
      .addColumn('nudge_status', 'varchar', (col) =>
        col
          .check(
            sql`nudge_status in ('queued','sent') or nudge_status LIKE 'error: %'`
          )
          .defaultTo('queued')
      )
      .execute();
    await db.schema
      .alterTable('tracking')
      .addColumn('tracking_status', 'varchar', (col) =>
        col
          .check(
            sql`tracking_status in ('queued','sent') or tracking_status LIKE 'error: %'`
          )
          .defaultTo('queued')
      )
      .execute();

    sql`update match set dm_handle_status = dm_handle_status_old, dm_address_status = dm_address_status_old`.execute(
      db
    );
    sql`update nudge set nudge_status = nudge_status_old`.execute(db);
    sql`update tracking set tracking_status = tracking_status_old`.execute(db);

    await db.schema
      .alterTable('match')
      .dropColumn('dm_handle_status_old')
      .execute();
    await db.schema
      .alterTable('match')
      .dropColumn('dm_address_status_old')
      .execute();
    await db.schema
      .alterTable('nudge')
      .dropColumn('nudge_status_old')
      .execute();
    await db.schema
      .alterTable('tracking')
      .dropColumn('tracking_status_old')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('match')
      .renameColumn('dm_handle_status', 'dm_handle_status_old')
      .execute();
    await db.schema
      .alterTable('match')
      .renameColumn('dm_address_status', 'dm_address_status_old')
      .execute();
    await db.schema
      .alterTable('nudge')
      .renameColumn('nudge_status', 'nudge_status_old')
      .execute();
    await db.schema
      .alterTable('tracking')
      .renameColumn('tracking_status', 'tracking_status_old')
      .execute();

    await db.schema
      .alterTable('match')
      .addColumn('dm_handle_status', 'varchar', (col) =>
        col
          .check(sql`dm_handle_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .execute();
    await db.schema
      .alterTable('match')
      .addColumn('dm_address_status', 'varchar', (col) =>
        col
          .check(sql`dm_address_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .execute();
    await db.schema
      .alterTable('nudge')
      .addColumn('nudge_status', 'varchar', (col) =>
        col
          .check(sql`nudge_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .execute();
    await db.schema
      .alterTable('tracking')
      .addColumn('tracking_status', 'varchar', (col) =>
        col
          .check(sql`tracking_status in ('queued','sent', 'error')`)
          .defaultTo('queued')
      )
      .execute();

    sql`update match set dm_handle_status = dm_handle_status_old, dm_address_status = dm_address_status_old`.execute(
      db
    );
    sql`update nudge set nudge_status = nudge_status_old`.execute(db);
    sql`update tracking set tracking_status = tracking_status_old`.execute(db);

    await db.schema
      .alterTable('match')
      .dropColumn('dm_handle_status_old')
      .execute();
    await db.schema
      .alterTable('match')
      .dropColumn('dm_address_status_old')
      .execute();
    await db.schema
      .alterTable('nudge')
      .dropColumn('nudge_status_old')
      .execute();
    await db.schema
      .alterTable('tracking')
      .dropColumn('tracking_status_old')
      .execute();
  },
};

migrations['005'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('player')
      .addColumn('next_player_dm', 'varchar', (col) =>
        col.defaultTo('signup-complete-1')
      )
      .execute();
    await db.schema
      .alterTable('player')
      .addColumn('next_player_dm_after', 'varchar')
      .execute();
    await db.schema
      .alterTable('player')
      .addColumn('player_dm_status', 'varchar', (col) =>
        col
          .check(
            sql`player_dm_status in ('queued','sent') or player_dm_status LIKE 'error: %'`
          )
          .defaultTo('queued')
      )
      .execute();

    await sql`drop trigger player_update_signup_complete`.execute(db);
    await sql`
      create trigger player_update_signup_complete after update of profile_complete, following_santa_uri, opted_out, booted, player_dm_status on player for each row begin
        update player set signup_complete = 1 where id = new.id and new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null and new.player_dm_status NOT LIKE 'error:%' and old.signup_complete = 0;
        update player set signup_complete = 0 where id = new.id and not (new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null and new.player_dm_status NOT LIKE 'error:%') and old.signup_complete = 1;

        update player set deactivated = 0 where id = new.id and new.opted_out is null and new.booted is null and old.deactivated = 1;
        update player set deactivated = 1 where id = new.id and not (new.opted_out is null and new.booted is null) and old.deactivated = 0;
      end;
    `.execute(db);

    await (db as Database)
      .updateTable('player')
      .set({
        player_dm_status: 'sent',
        next_player_dm_after: new Date().toISOString(),
      })
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger player_update_signup_complete`.execute(db);
    await sql`
      create trigger player_update_signup_complete after update of profile_complete, following_santa_uri, opted_out, booted on player for each row begin
        update player set signup_complete = 1 where id = new.id and new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null and old.signup_complete = 0;
        update player set signup_complete = 0 where id = new.id and not (new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null) and old.signup_complete = 1;

        update player set deactivated = 0 where id = new.id and new.opted_out is null and new.booted is null and old.deactivated = 1;
        update player set deactivated = 1 where id = new.id and not (new.opted_out is null and new.booted is null) and old.deactivated = 0;
      end;
    `.execute(db);

    await db.schema.alterTable('player').dropColumn('next_player_dm').execute();
    await db.schema
      .alterTable('player')
      .dropColumn('next_player_dm_after')
      .execute();
    await db.schema
      .alterTable('player')
      .dropColumn('player_dm_status')
      .execute();
  },
};

migrations['006'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .addColumn('signups_open_date', 'varchar', (col) =>
        col.notNull().defaultTo('2025-04-01')
      )
      .execute();
    await db.schema
      .alterTable('settings')
      .addColumn('signups_close_date', 'varchar', (col) =>
        col.notNull().defaultTo('2025-04-15')
      )
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .dropColumn('signups_open_date')
      .execute();
    await db.schema
      .alterTable('settings')
      .dropColumn('signups_close_date')
      .execute();
  },
};

migrations['007'] = {
  async up(db: Kysely<unknown>) {
    for (const message of initialHintIdeas) {
      await (db as Database)
        .insertInto('message')
        .values({ message_type: 'hint-idea', message })
        .execute();
    }
  },
  async down(db: Kysely<unknown>) {
    await (db as Database)
      .deleteFrom('message')
      .where('message_type', '=', 'hint-idea')
      .execute();
  },
};

migrations['008'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('tracking')
      .addColumn('deactivated', 'varchar')
      .execute();

    await sql`
      create trigger tracking_on_deactivated_change after update of deactivated on tracking for each row begin
        update match set tracking_count = tracking_count - 1 where id = new.match and new.deactivated is not null and old.deactivated is null;
        update match set tracking_missing_count = tracking_missing_count - 1 where id = new.match and new.missing is not null and new.deactivated is not null and old.deactivated is null;

        update match set tracking_count = tracking_count + 1 where id = new.match and new.deactivated is null and old.deactivated is not null;
        update match set tracking_missing_count = tracking_missing_count + 1 where id = new.match and new.missing is not null and new.deactivated is null and old.deactivated is not null;
      end;
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger tracking_on_deactivated_change`.execute(db);

    await db.schema.alterTable('tracking').dropColumn('deactivated').execute();
  },
};

migrations['009'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('author', 'varchar', (col) => col.notNull())
      .addColumn('replyParent', 'varchar')
      .addColumn('replyParentAuthor', 'varchar')
      .addColumn('indexedAt', 'varchar')
      .addColumn('time_us', 'numeric', (col) => col.notNull())
      .addColumn('hasHashtag', 'int2', (col) => col.notNull())
      .addColumn('byPlayer', 'int2', (col) => col.notNull())
      .addColumn('distanceFromHashtag', 'numeric', (col) => col.notNull())
      .addColumn('distanceFromPlayerWithHashtag', 'numeric', (col) =>
        col.notNull()
      )
      .addColumn('rootByPlayerWithHashtag', 'numeric', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('idx_post_indexedAt_distanceFromHashtag')
      .on('post')
      .columns(['indexedAt', 'distanceFromHashtag'])
      .execute();

    await db.schema
      .createIndex('idx_post_indexedAt_distanceFromPlayerWithHashtag')
      .on('post')
      .columns(['indexedAt', 'distanceFromPlayerWithHashtag'])
      .execute();

    await db.schema
      .createIndex('idx_post_time_us')
      .on('post')
      .columns(['indexedAt', 'time_us'])
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('feed_player_only', 'int2', (col) =>
        col.notNull().defaultTo(0)
      )
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('feed_max_distance_from_tag', 'numeric', (col) =>
        col.notNull().defaultTo(4)
      )
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .dropColumn('feed_player_only')
      .execute();
    await db.schema
      .alterTable('settings')
      .dropColumn('feed_max_distance_from_tag')
      .execute();
    await db.schema
      .dropIndex('idx_post_indexedAt_distanceFromHashtag')
      .execute();
    await db.schema
      .dropIndex('idx_post_indexedAt_distanceFromPlayerWithHashtag')
      .execute();
    await db.schema.dropIndex('idx_post_time_us').execute();
    await db.schema.dropTable('post').execute();
  },
};

migrations['010'] = {
  async up(db: Kysely<unknown>) {
    await db.schema.dropTable('auth_request').execute();

    const signoffResult = await (db as Database)
      .insertInto('nudge_signoff')
      .values({
        text: 'Oh, and what is your favourite colour?',
      })
      .executeTakeFirst();

    const hintTypeId = await (db as Database)
      .selectFrom('nudge_type')
      .select('id')
      .where('name', '=', 'Hint')
      .executeTakeFirstOrThrow();
    await (db as Database)
      .insertInto('nudge_type_signoff')
      .values({
        signoff: Number(signoffResult.insertId!),
        nudge_type: hintTypeId.id,
      })
      .execute();
  },
  async down(db: Kysely<unknown>) {
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
  },
};

migrations['011'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('mastodon_client')
      .addColumn('instance', 'varchar', (col) => col.primaryKey())
      .addColumn('client_id', 'varchar', (col) => col.notNull())
      .addColumn('client_secret', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('mastodon_token')
      .addColumn('account', 'varchar', (col) => col.primaryKey())
      .addColumn('mastodon_id', 'varchar', (col) => col.notNull())
      .addColumn('token', 'varchar', (col) => col.notNull())
      .addColumn('client_id', 'varchar', (col) => col.notNull())
      .addColumn('issued_at', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('player_type', 'varchar', (col) =>
        col
          .notNull()
          .check(sql`player_type in ('bluesky', 'mastodon')`)
          .defaultTo('bluesky')
      )
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('mastodon_account', 'varchar')
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('mastodon_id', 'varchar')
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('mastodon_following_santa', 'int2')
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('mastodon_followed_by_santa', 'int2')
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('mastodon_follow_last_checked', 'varchar')
      .execute();

    await db.schema
      .createIndex('idx_player_mastodon_follow_last_checked')
      .on('player')
      .column('mastodon_follow_last_checked')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .dropIndex('idx_player_mastodon_follow_last_checked')
      .execute();
    await db.schema.alterTable('player').dropColumn('player_type').execute();
    await db.schema
      .alterTable('player')
      .dropColumn('mastodon_account')
      .execute();
    await db.schema.alterTable('player').dropColumn('mastodon_id').execute();
    await db.schema
      .alterTable('player')
      .dropColumn('mastodon_following_santa')
      .execute();
    await db.schema
      .alterTable('player')
      .dropColumn('mastodon_followed_by_santa')
      .execute();
    await db.schema
      .alterTable('player')
      .dropColumn('mastodon_follow_last_checked')
      .execute();

    await db.schema.dropTable('mastodon_token').execute();
    await db.schema.dropTable('mastodon_client').execute();
  },
};

migrations['012'] = {
  async up(db: Kysely<unknown>) {
    await sql`drop trigger player_update_signup_complete`.execute(db);
    await sql`
      create trigger player_update_signup_complete after update of profile_complete, following_santa_uri, opted_out, booted, player_dm_status, player_type, mastodon_following_santa on player for each row begin
        update player set signup_complete = 1 where id = new.id and (
          new.profile_complete = 1
          and new.following_santa_uri is not null
          and new.opted_out is null
          and new.booted is null
          and new.player_dm_status NOT LIKE 'error:%'
          and (new.player_type <> 'mastodon' or new.mastodon_following_santa = 1)
        ) and old.signup_complete = 0;
        update player set signup_complete = 0 where id = new.id and not (
          new.profile_complete = 1
          and new.following_santa_uri is not null
          and new.opted_out is null
          and new.booted is null
          and new.player_dm_status NOT LIKE 'error:%'
          and (new.player_type <> 'mastodon' or new.mastodon_following_santa = 1)
        ) and old.signup_complete = 1;

        update player set deactivated = 0 where id = new.id and new.opted_out is null and new.booted is null and old.deactivated = 1;
        update player set deactivated = 1 where id = new.id and not (new.opted_out is null and new.booted is null) and old.deactivated = 0;
      end;
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger player_update_signup_complete`.execute(db);
    await sql`
      create trigger player_update_signup_complete after update of profile_complete, following_santa_uri, opted_out, booted, player_dm_status on player for each row begin
        update player set signup_complete = 1 where id = new.id and new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null and new.player_dm_status NOT LIKE 'error:%' and old.signup_complete = 0;
        update player set signup_complete = 0 where id = new.id and not (new.profile_complete = 1 and new.following_santa_uri is not null and new.opted_out is null and new.booted is null and new.player_dm_status NOT LIKE 'error:%') and old.signup_complete = 1;

        update player set deactivated = 0 where id = new.id and new.opted_out is null and new.booted is null and old.deactivated = 1;
        update player set deactivated = 1 where id = new.id and not (new.opted_out is null and new.booted is null) and old.deactivated = 0;
      end;
    `.execute(db);
  },
};

migrations['013'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('player')
      .addColumn('mastodon_host', 'varchar')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('player').dropColumn('mastodon_host').execute();
  },
};

migrations['014'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .addColumn('mastodon_players', 'int2', (col) =>
        col.notNull().defaultTo(0)
      )
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .dropColumn('mastodon_players')
      .execute();
  },
};

migrations['015'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('note')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('player_id', 'integer', (col) => col.notNull())
      .addColumn('text', 'varchar', (col) => col.notNull())
      .addColumn('author', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .addForeignKeyConstraint('fk_note_player', ['player_id'], 'player', [
        'id',
      ])
      .execute();

    await db.schema
      .alterTable('player')
      .addColumn('note_count', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();

    await sql`
      create trigger note_after_insert after insert on note for each row begin
        update player set note_count = note_count + 1 where id = new.player_id;
      end;
    `.execute(db);

    await sql`
      create trigger note_after_delete after delete on note for each row begin
        update player set note_count = note_count - 1 where id = old.player_id;
      end;
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger note_after_insert`.execute(db);
    await sql`drop trigger note_after_delete`.execute(db);

    await db.schema.alterTable('player').dropColumn('note_count').execute();

    await db.schema.dropTable('note').execute();
  },
};

migrations['016'] = {
  async up(db: Kysely<unknown>) {
    await db.schema.dropTable('note').execute();
    await db.schema
      .createTable('note')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('player_did', 'varchar', (col) => col.notNull())
      .addColumn('text', 'varchar', (col) => col.notNull())
      .addColumn('author', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('idx_note_player_did')
      .on('note')
      .column('player_did')
      .execute();

    await (db as Database)
      .updateTable('player')
      .set({ note_count: 0 })
      .execute();

    await sql`
      create trigger note_after_insert after insert on note for each row begin
        update player set note_count = note_count + 1 where did = new.player_did;
      end;
    `.execute(db);

    await sql`
      create trigger note_after_delete after delete on note for each row begin
        update player set note_count = note_count - 1 where did = old.player_did;
      end;
    `.execute(db);

    await sql`drop trigger player_after_insert`.execute(db);
    await sql`
    create trigger player_after_insert after insert on player for each row begin
      update player set profile_complete = 1 where id = new.id and new.address is not null and new.address <> '' and new.game_mode is not null;

      update player set giftee_count_status = 'can_have_more' where id = new.id and max_giftees is not null and giftee_count < max_giftees;
      update player set giftee_count_status = 'full' where id = new.id and max_giftees is not null and giftee_count = max_giftees;
      update player set giftee_count_status = 'too_many' where id = new.id and max_giftees is not null and giftee_count > max_giftees;

      update player set note_count = (select count(*) from note where note.player_did = player.did) where player.did = new.did;
    end;
  `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await (db as Database)
      .updateTable('player')
      .set({ note_count: 0 })
      .execute();

    await db.schema.dropIndex('idx_note_player_did').execute();
    await db.schema.dropTable('note').execute();

    await db.schema
      .createTable('note')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('player_id', 'integer', (col) => col.notNull())
      .addColumn('text', 'varchar', (col) => col.notNull())
      .addColumn('author', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .addForeignKeyConstraint('fk_note_player', ['player_id'], 'player', [
        'id',
      ])
      .execute();

    await sql`
        create trigger note_after_insert after insert on note for each row begin
          update player set note_count = note_count + 1 where id = new.player_id;
        end;
      `.execute(db);

    await sql`
        create trigger note_after_delete after delete on note for each row begin
          update player set note_count = note_count - 1 where id = old.player_id;
        end;
      `.execute(db);

    await sql`drop trigger player_after_insert`.execute(db);
    await sql`
    create trigger player_after_insert after insert on player for each row begin
      update player set profile_complete = 1 where id = new.id and new.address is not null and new.address <> '' and new.game_mode is not null;

      update player set giftee_count_status = 'can_have_more' where id = new.id and max_giftees is not null and giftee_count < max_giftees;
      update player set giftee_count_status = 'full' where id = new.id and max_giftees is not null and giftee_count = max_giftees;
      update player set giftee_count_status = 'too_many' where id = new.id and max_giftees is not null and giftee_count > max_giftees;
    end;
  `.execute(db);
  },
};

migrations['017'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('otp_login')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('code', 'varchar', (col) => col.notNull())
      .addColumn('did', 'varchar', (col) => col.notNull())
      .addColumn('expires', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('idx_otp_login_expires')
      .on('otp_login')
      .column('expires')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('idx_otp_login_expires').execute();
    await db.schema.dropTable('otp_login').execute();
  },
};

migrations['018'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('otp_login')
      .addColumn('attempts', 'numeric', (col) => col.defaultTo(0).notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('otp_login').dropColumn('attempts').execute();
  },
};

migrations['019'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('player')
      .addColumn('post_count', 'numeric', (col) => col.defaultTo(0).notNull())
      .execute();
    await db.schema
      .alterTable('player')
      .addColumn('post_count_since_signup', 'numeric', (col) =>
        col.defaultTo(0).notNull()
      )
      .execute();
    await db.schema
      .alterTable('player')
      .addColumn('last_checked_post_count', 'varchar', (col) =>
        col.defaultTo('1970-01-01T00:00:00.000Z').notNull()
      )
      .execute();
    await db.schema
      .createIndex('idx_player_last_checked_post_count')
      .on('player')
      .column('last_checked_post_count')
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('idx_player_last_checked_post_count').execute();

    await db.schema.alterTable('player').dropColumn('post_count').execute();
    await db.schema
      .alterTable('player')
      .dropColumn('post_count_since_signup')
      .execute();
    await db.schema
      .alterTable('player')
      .dropColumn('last_checked_post_count')
      .execute();
  },
};

migrations['020'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .addColumn('feed_hashtags', 'varchar', (col) =>
        col
          .defaultTo(
            '#MWSecretSantaAoNZ, #MWSecretSantaNZ, #MWSecretSanta, #MWSS, #SecretSantaAoNZ, #SecretSantaNZ, #NZSecretSanta'
          )
          .notNull()
      )
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('settings')
      .dropColumn('feed_hashtags')
      .execute();
  },
};

migrations['021'] = {
  async up(db: Kysely<unknown>) {
    await (db as Database)
      .deleteFrom('message')
      .where('message_type', '=', 'dm-match-address')
      .execute();

    await (db as Database)
      .insertInto('message')
      .values(
        initialMessages['dm-match-address'].map((message) => ({
          message_type: 'dm-match-address',
          message,
        }))
      )
      .execute();
  },
  async down() {},
};

migrations['022'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('badge')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('title', 'varchar', (col) => col.notNull())
      .addColumn('description', 'varchar', (col) => col.notNull())
      .addColumn('image_url', 'varchar', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('player_badge')
      .addColumn('player_did', 'varchar', (col) => col.notNull())
      .addColumn('badge_id', 'integer', (col) => col.notNull())
      .addColumn('recorded_at', 'varchar', (col) => col.notNull())
      .addForeignKeyConstraint('fk_player_badge_badge', ['badge_id'], 'badge', [
        'id',
      ])
      .addUniqueConstraint('unq_player_badge_player_badge', [
        'player_did',
        'badge_id',
      ])
      .execute();

    await db.schema
      .createIndex('idx_player_badge_player_did')
      .on('player_badge')
      .column('player_did')
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('show_badges', 'int2', (col) => col.notNull().defaultTo(0))
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('current_game_badge_id', 'integer')
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('sent_present_badge_id', 'integer')
      .execute();

    await db.schema
      .alterTable('settings')
      .addColumn('super_santa_badge_id', 'integer')
      .execute();

    await sql`
      create trigger match_insert_add_badges after insert on match for each row when new.match_status = 'locked' and new.deactivated is null begin
        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, current_game_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.current_game_badge_id is not null
        on conflict do nothing;

        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, super_santa_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.super_santa_badge_id is not null
          and (
            (select count(*) from match where santa = new.santa and match_status = 'locked') > 1
            or new.super_santa_match = 1
          )
        on conflict do nothing;
      end;
    `.execute(db);

    await sql`
      create trigger match_update_add_badges after update on match for each row when new.match_status = 'locked' and new.deactivated is null begin
        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, current_game_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.current_game_badge_id is not null
        on conflict do nothing;

        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, super_santa_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.super_santa_badge_id is not null
          and (
            (select count(*) from match where santa = new.santa and match_status = 'locked') > 1
            or new.super_santa_match = 1
          )
        on conflict do nothing;
      end;
    `.execute(db);

    await (db as Database)
      .insertInto('badge')
      .values([
        {
          id: 1,
          title: 'Present Sent!',
          description:
            "Ngā mihi! You've earned yourself the badge for being a great Santa and sending your gift on time. You're awesome!",
          image_url:
            'https://secretsantanz.imgix.net/badge-placeholder-b11c008e-69ca-45e2-9b53-b8768122e7d2?w=386&w386&auto=format',
        },
        {
          id: 2,
          title: 'MW 2025 Super Santa!',
          description:
            "Your kindness is legendary! You've earned the Super Santa badge. A little thank you for helping share the joy a little further.",
          image_url:
            'https://secretsantanz.imgix.net/badge-placeholder-b11c008e-69ca-45e2-9b53-b8768122e7d2?w=386&w386&auto=format',
        },
        {
          id: 3,
          title: 'MW 2025',
          description:
            "Celebrate good times, come on let's celebrate. Surprise, you get this badge for being an OG player of the first Bluesky Secret Santa AoNZ. Thanks for being part of the joy.",
          image_url:
            'https://secretsantanz.imgix.net/badge-placeholder-b11c008e-69ca-45e2-9b53-b8768122e7d2?w=386&w386&auto=format',
        },
      ])
      .execute();

    await (db as Database)
      .updateTable('settings')
      .set({
        sent_present_badge_id: 1,
        super_santa_badge_id: 2,
        current_game_badge_id: 3,
      })
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger match_update_add_badges`.execute(db);
    await sql`drop trigger match_insert_add_badges`.execute(db);

    await db.schema.dropIndex('idx_player_badge_player_did').execute();

    await db.schema.dropTable('player_badge').execute();

    await db.schema.dropTable('badge').execute();

    await db.schema.alterTable('settings').dropColumn('show_badges').execute();

    await db.schema
      .alterTable('settings')
      .dropColumn('current_game_badge_id')
      .execute();

    await db.schema
      .alterTable('settings')
      .dropColumn('sent_present_badge_id')
      .execute();

    await db.schema
      .alterTable('settings')
      .dropColumn('super_santa_badge_id')
      .execute();
  },
};

migrations['023'] = {
  async up(db: Kysely<unknown>) {
    await sql`drop trigger match_insert_add_badges`.execute(db);
    await sql`
      create trigger match_insert_add_badges after insert on match for each row when new.match_status = 'locked' and new.deactivated is null begin
        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, current_game_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.current_game_badge_id is not null
        on conflict do nothing;

        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, super_santa_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.super_santa_badge_id is not null
          and (
            (select count(*) from match where santa = new.santa and match_status = 'locked' and match.deactivated is null) > 1
            or new.super_santa_match = 1
          )
        on conflict do nothing;
      end;
    `.execute(db);

    await sql`drop trigger match_update_add_badges`.execute(db);
    await sql`
      create trigger match_update_add_badges after update on match for each row when new.match_status = 'locked' and new.deactivated is null begin
        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, current_game_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.current_game_badge_id is not null
        on conflict do nothing;

        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, super_santa_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.super_santa_badge_id is not null
          and (
            (select count(*) from match where santa = new.santa and match_status = 'locked' and match.deactivated is null) > 1
            or new.super_santa_match = 1
          )
        on conflict do nothing;
      end;
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger match_insert_add_badges`.execute(db);
    await sql`
      create trigger match_insert_add_badges after insert on match for each row when new.match_status = 'locked' and new.deactivated is null begin
        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, current_game_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.current_game_badge_id is not null
        on conflict do nothing;

        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, super_santa_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.super_santa_badge_id is not null
          and (
            (select count(*) from match where santa = new.santa and match_status = 'locked') > 1
            or new.super_santa_match = 1
          )
        on conflict do nothing;
      end;
    `.execute(db);

    await sql`drop trigger match_update_add_badges`.execute(db);
    await sql`
      create trigger match_update_add_badges after update on match for each row when new.match_status = 'locked' and new.deactivated is null begin
        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, current_game_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.current_game_badge_id is not null
        on conflict do nothing;

        insert into player_badge (player_did, badge_id, recorded_at)
          select player.did, super_santa_badge_id, datetime('now')
          from player
          inner join settings
          where player.id = new.santa
          and settings.super_santa_badge_id is not null
          and (
            (select count(*) from match where santa = new.santa and match_status = 'locked') > 1
            or new.super_santa_match = 1
          )
        on conflict do nothing;
      end;
    `.execute(db);
  },
};

migrations['024'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('badge')
      .addColumn('assigned_by_hashtag', 'varchar')
      .execute();
    await db.schema
      .alterTable('badge')
      .addColumn('assigned_by_elf', 'int2', (col) => col.defaultTo(0).notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('badge')
      .dropColumn('assigned_by_hashtag')
      .execute();
    await db.schema.alterTable('badge').dropColumn('assigned_by_elf').execute();
  },
};

migrations['025'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('player')
      .addColumn('address_location', 'varchar')
      .execute();

    const players = await (db as Database)
      .selectFrom('player')
      .select(['id', 'handle', 'address'])
      .where('address', 'is not', null)
      .execute();
    for (const player of players) {
      const location = await getLocation(
        player.handle,
        player.address as string
      );
      await (db as Database)
        .updateTable('player')
        .set({
          address_location: location ? JSON.stringify(location) : null,
        })
        .where('id', '=', player.id)
        .execute();
    }
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('player')
      .dropColumn('address_location')
      .execute();
  },
};

migrations['026'] = {
  async up(db: Kysely<unknown>) {
    await sql`drop trigger match_on_insert`.execute(db);
    await sql`
      create trigger match_on_insert after insert on match for each row when new.deactivated is null and new.super_santa_match <> 1 begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftee_count = giftee_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`drop trigger match_on_deactivated`.execute(db);
    await sql`
      create trigger match_on_deactivated after update of deactivated on match for each row when old.deactivated is null and new.deactivated is not null and new.super_santa_match <> 1 begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftee_count = giftee_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await sql`drop trigger match_on_reactivated`.execute(db);
    await sql`
      create trigger match_on_reactivated after update of deactivated on match for each row when old.deactivated is not null and new.deactivated is null and new.super_santa_match <> 1 begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftee_count = giftee_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`drop trigger match_on_delete`.execute(db);
    await sql`
      create trigger match_on_delete after delete on match for each row when old.deactivated is null and old.super_santa_match <> 1 begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftee_count = giftee_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await sql`
      update player set
        giftee_for_count = (select count(*) from match where match.giftee = player.id and match.deactivated is null and match.super_santa_match <> 1),
        locked_giftee_for_count = (select count(*) from match where match.giftee = player.id and match.match_status = 'locked' and match.deactivated is null and match.super_santa_match <> 1),
        giftee_count = (select count(*) from match where match.santa = player.id and match.deactivated is null and match.super_santa_match <> 1)
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop trigger match_on_insert`.execute(db);
    await sql`
      create trigger match_on_insert after insert on match for each row when new.deactivated is null begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftee_count = giftee_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`drop trigger match_on_deactivated`.execute(db);
    await sql`
      create trigger match_on_deactivated after update of deactivated on match for each row when old.deactivated is null and new.deactivated is not null begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftee_count = giftee_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await sql`drop trigger match_on_reactivated`.execute(db);
    await sql`
      create trigger match_on_reactivated after update of deactivated on match for each row when old.deactivated is not null and new.deactivated is null begin
        update player set giftee_for_count = giftee_for_count + 1 where id = new.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count + 1 where id = new.giftee and new.match_status = 'locked';
        update player set giftee_count = giftee_count + 1 where id = new.santa;
      end;
    `.execute(db);

    await sql`drop trigger match_on_delete`.execute(db);
    await sql`
      create trigger match_on_delete after delete on match for each row when old.deactivated is null begin
        update player set giftee_for_count = giftee_for_count - 1 where id = old.giftee;
        update player set locked_giftee_for_count = locked_giftee_for_count - 1 where id = old.giftee and old.match_status = 'locked';
        update player set giftee_count = giftee_count - 1 where id = old.santa;
      end;
    `.execute(db);

    await sql`
      update player set
        giftee_for_count = (select count(*) from match where match.giftee = player.id and match.deactivated is null),
        locked_giftee_for_count = (select count(*) from match where match.giftee = player.id and match.match_status = 'locked' and match.deactivated is null),
        giftee_count = (select count(*) from match where match.santa = player.id and match.deactivated is null)
    `.execute(db);
  },
};
