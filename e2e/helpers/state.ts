import { randomUUID } from 'node:crypto';
import type { Updateable } from 'kysely';
import type { Database } from '../../src/lib/database/index.js';
import type { NudgeType, Settings } from '../../src/lib/database/schema.js';
import { formatISO } from 'date-fns';

/**
 * Bootstrap helpers: seed exactly the state a test needs by writing real rows
 * (or calling real service code) into the test's own database. No mocks.
 */

const now = () => new Date().toISOString();

export const getPlayerRow = async (db: Database, did: string) =>
  db
    .selectFrom('player')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirstOrThrow();

export interface MatchSeed {
  match_status: 'draft' | 'shared' | 'locked';
  has_present?: number;
  super_santa_match?: number;
  dm_handle_status?: 'queued' | 'sent' | `error: ${string}`;
  dm_address_status?: 'queued' | 'sent' | `error: ${string}`;
}

/** Create a santa -> giftee match between two player dids. */
export const createMatch = async (
  db: Database,
  santaDid: string,
  gifteeDid: string,
  seed: MatchSeed = { match_status: 'locked' }
) => {
  const santa = await getPlayerRow(db, santaDid);
  const giftee = await getPlayerRow(db, gifteeDid);
  const matchId = await db
    .insertInto('match')
    .values({
      santa: santa.id,
      giftee: giftee.id,
      match_status: seed.match_status,
      has_present: seed.has_present ?? 0,
      invalid_player: 0,
      nudge_count: 0,
      nudge_present_update_count: 0,
      tracking_count: 0,
      tracking_missing_count: 0,
      super_santa_match: seed.super_santa_match ?? 0,
      dm_handle_status: seed.dm_handle_status ?? 'queued',
      dm_address_status: seed.dm_address_status ?? 'queued',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return matchId;
};

/** Queue a nudge of the given type on a match. */
export const queueNudge = async (
  db: Database,
  matchId: number,
  nudgeType: NudgeType['name']
) => {
  const type = await db
    .selectFrom('nudge_type')
    .selectAll()
    .where('name', '=', nudgeType)
    .executeTakeFirstOrThrow();
  const greeting = await db
    .selectFrom('nudge_type_greeting')
    .innerJoin(
      'nudge_greeting',
      'nudge_greeting.id',
      'nudge_type_greeting.greeting'
    )
    .select('nudge_greeting.id as id')
    .where('nudge_type', '=', type.id)
    .orderBy('nudge_greeting.id', 'asc')
    .executeTakeFirstOrThrow();
  const signoff = await db
    .selectFrom('nudge_type_signoff')
    .innerJoin(
      'nudge_signoff',
      'nudge_signoff.id',
      'nudge_type_signoff.signoff'
    )
    .select('nudge_signoff.id as id')
    .where('nudge_type', '=', type.id)
    .orderBy('nudge_signoff.id', 'asc')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('nudge')
    .values({
      nudge_type: type.id,
      nudge_greeting: greeting.id,
      nudge_signoff: signoff.id,
      match: matchId,
      nudge_status: 'queued',
      created_at: now(),
      created_by: 'e2e',
    })
    .execute();
  const nudgeRow = await db
    .selectFrom('nudge')
    .selectAll()
    .where('match', '=', matchId)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  return nudgeRow;
};

/** Add a tracking (sent present) row on a match, using the first carrier.
 * The `tracking_on_insert` trigger maintains match.tracking_count. */
export const createTracking = async (
  db: Database,
  matchId: number,
  overrides: Partial<{
    giftwrap_status: number;
    missing: string | null;
    tracking_status: 'queued' | 'sent' | 'error';
  }> = {}
) => {
  const carrier = await db
    .selectFrom('carrier')
    .selectAll()
    .orderBy('id', 'asc')
    .executeTakeFirstOrThrow();
  const trackingRow = await db
    .insertInto('tracking')
    .values({
      carrier: carrier.id,
      shipped_date: '2025-12-20',
      tracking_number: `NZ${randomUUID().slice(0, 8).toUpperCase()}`,
      giftwrap_status: overrides.giftwrap_status ?? 1,
      match: matchId,
      tracking_status: overrides.tracking_status ?? 'sent',
      created_at: now(),
      created_by: 'e2e',
      missing: overrides.missing ?? null,
    } as never)
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .updateTable('match')
    .set({ has_present: 1 })
    .where('id', '=', matchId)
    .execute();
  return trackingRow;
};

export const createBadge = async (
  db: Database,
  title: string,
  description = 'An e2e badge'
) =>
  db
    .insertInto('badge')
    .values({
      title,
      description,
      image_url: `https://cdn.example.com/badges/${title}.png`,
      assigned_by_elf: 0,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const assignBadge = async (
  db: Database,
  playerDid: string,
  badgeId: number
) =>
  db
    .insertInto('player_badge')
    .values({ player_did: playerDid, badge_id: badgeId, recorded_at: now() })
    .execute();

export const seedOpeningPost = async (
  db: Database,
  playerDid: string,
  index: number
) => {
  const uri = `at://${playerDid}/app.bsky.feed.post/opening-${index}`;
  const indexedAt = formatISO(new Date(2025, 11, 26, 12, 0, index));
  const post = {
    uri,
    author: playerDid,
    replyParent: null,
    replyParentAuthor: null,
    indexedAt,
    time_us: new Date(indexedAt).getTime() * 1000,
    hasHashtag: 1 as const,
    byPlayer: 1 as const,
    distanceFromHashtag: 0,
    distanceFromPlayerWithHashtag: 0,
    rootByPlayerWithHashtag: 0 as const,
  };
  await db.insertInto('post').values(post).execute();
  return post;
};

type SettingsOverrides = Partial<Updateable<Settings>>;

/** Configure the single settings row. */
export const setSettings = async (
  db: Database,
  overrides: SettingsOverrides
) => {
  await db.updateTable('settings').set(overrides).where('id', '=', 0).execute();
  return db
    .selectFrom('settings')
    .selectAll()
    .where('id', '=', 0)
    .executeTakeFirstOrThrow();
};

/** Default game dates that make most flows act "in season". */
export const defaultSettings = () =>
  ({
    signups_open: 1,
    signups_open_date: '2024-01-01',
    signups_close_date: isoFutureDate(30),
    matches_sent_date: isoFutureDate(7),
    send_by_date: isoFutureDate(30),
    opening_date: isoFutureDate(45),
    send_messages: 0,
    auto_follow: 0,
    show_badges: 1,
  }) satisfies SettingsOverrides;

const isoFutureDate = (daysAhead: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
};

/** Boot a player out (as the admin would). */
export const bootPlayer = async (db: Database, did: string, by = 'headelf') =>
  db
    .updateTable('player')
    .set({ booted: now(), booted_by: by })
    .where('did', '=', did)
    .execute();

/** Opt a player out. */
export const optOutPlayer = async (db: Database, did: string) =>
  db
    .updateTable('player')
    .set({ opted_out: now() })
    .where('did', '=', did)
    .execute();
