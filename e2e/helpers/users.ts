import type { Database } from '../../src/lib/database/index.js';

/**
 * Static test users. These are synthetic rows seeded into each test's own
 * in-memory database -- nothing is ever registered at Bluesky or Mastodon.
 * The fake-Bluesky MSW handlers serve profiles/relationships for these users.
 */
export interface StaticUser {
  key: string;
  handle: string;
  did: string;
  admin?: number;
  game_mode: null | 'Regular' | 'Super Santa' | 'Santa Only' | 'Giftee Only';
  max_giftees: number;
  address: string | null;
  delivery_instructions: string | null;
  /** Bluesky profile has chat DMs disabled (allowIncoming: 'none') */
  dms_disabled?: boolean;
  /** Does not follow the santa account (relationship .followedBy missing) */
  not_following?: boolean;
  booted?: string | null;
  opted_out?: string | null;
}

const user = (
  key: string,
  overrides: Partial<StaticUser> = {}
): StaticUser => ({
  key,
  handle: `${key}.test.bsky.social`,
  did: `did:plc:e2e${key}`,
  game_mode: 'Regular',
  max_giftees: 2,
  address: `${key} Street 1, Wellington`,
  delivery_instructions: `Gate code 1234 (${key})`,
  admin: 0,
  ...overrides,
});

/** Head elf (admin). */
export const headelf = user('headelf', { admin: 1 });

/** The five regular players needed for auto-match (requires >= 5 eligible). */
export const alice = user('alice');
export const bob = user('bob');
export const carol = user('carol');
export const dave = user('dave');
export const eve = user('eve');

/** Super Santa with room for several giftees. */
export const supersanta = user('supersanta', {
  game_mode: 'Super Santa',
  max_giftees: 3,
});

export const santaonly = user('santaonly', { game_mode: 'Santa Only' });

export const gifteeonly = user('gifteeonly', {
  game_mode: 'Giftee Only',
  max_giftees: 0,
});

/** Boot-out / restore target. */
export const trouble = user('trouble');

/** Opt-out / opt-in player. */
export const shy = user('shy');

/** Player that has not finished signup onboarding (no address / game mode). */
export const slowpoke = user('slowpoke', {
  address: null,
  delivery_instructions: null,
  game_mode: null,
});

/** Player with DMs disabled on their Bluesky profile. */
export const natter = user('natter', { dms_disabled: true });

/** Player with badges + history for the home screen displays. */
export const oldfriend = user('oldfriend', {
  game_mode: 'Regular',
});

export const staticUsers: Array<StaticUser> = [
  headelf,
  alice,
  bob,
  carol,
  dave,
  eve,
  supersanta,
  santaonly,
  gifteeonly,
  trouble,
  shy,
  slowpoke,
  natter,
  oldfriend,
];

export const usersByHandle = new Map(staticUsers.map((u) => [u.handle, u]));
export const usersByDid = new Map(staticUsers.map((u) => [u.did, u]));

//Santa account used by the bridge itself.
export const santaDid = 'did:plc:e2esanta';
export const robotDid = 'did:plc:e2erobot';
export const identityByHandle = new Map<string, string>([
  [santaDid, santaDid],
  ['santa.test.bsky.social', santaDid],
  ['robot.test.bsky.social', robotDid],
  ...staticUsers.map((u) => [u.handle, u.did] as [string, string]),
]);

type PlayerSeed = Partial<
  Omit<StaticUser, 'key'> & {
    signup_complete?: number;
    profile_complete?: number;
    next_player_dm?:
      | null
      | 'signup-complete-1'
      | 'signup-complete-2'
      | 'signup-complete-3'
      | 'signup-complete-4';
    next_player_dm_after?: string | null;
  }
>;

export const insertPlayerRow = async (
  db: Database,
  u: StaticUser,
  overrides: PlayerSeed = {}
) => {
  // Allow overriding the "static profile" properties too (e.g. not_following).
  const effective: StaticUser = {
    ...u,
    not_following: overrides.not_following ?? u.not_following,
    dms_disabled: overrides.dms_disabled ?? u.dms_disabled,
    admin: overrides.admin ?? u.admin,
    booted: overrides.booted ?? u.booted,
    opted_out: overrides.opted_out ?? u.opted_out,
  };
  const {
    not_following: _nf,
    dms_disabled: _dms,
    admin: _admin,
    booted: _booted,
    opted_out: _optedOut,
    ...restOverrides
  } = overrides;
  void _nf;
  void _dms;
  void _admin;
  void _booted;
  void _optedOut;
  const { game_mode } = restOverrides;

  await db
    .insertInto('player')
    .values({
      did: effective.did,
      handle: effective.handle,
      admin: effective.admin ?? 0,
      player_type: 'bluesky',
      game_mode: game_mode === undefined ? effective.game_mode : game_mode,
      max_giftees: effective.max_giftees,
      address: effective.address,
      address_review_required: null,
      delivery_instructions: effective.delivery_instructions,
      avatar_url: `https://cdn.example.com/avatars/${effective.key}.png`,
      profile_complete: overrides.profile_complete ?? 1,
      signup_complete: overrides.signup_complete ?? 1,
      following_santa_uri: effective.not_following
        ? null
        : `at://${santaDid}/app.bsky.graph.follow/${effective.key}-follow-1`,
      santa_following_uri: `at://${effective.did}/app.bsky.graph.follow/${effective.key}-follow-2`,
      player_dm_status: effective.dms_disabled
        ? 'error: DMs Disabled'
        : 'queued',
      note_count: 0,
      post_count: 3,
      post_count_since_signup: 1,
      ...restOverrides,
    } as never)
    .execute();

  return await db
    .selectFrom('player')
    .selectAll()
    .where('did', '=', effective.did)
    .executeTakeFirstOrThrow();
};

export interface Users {
  all: Array<StaticUser>;
  byKey: (key: string) => StaticUser;
}

/** Seed all static users into the test database. */
export const seedUsers = async (db: Database, keys?: Array<string>) => {
  const selected =
    keys == null
      ? staticUsers
      : staticUsers.filter((u) => keys.includes(u.key) || u.key === 'headelf');
  for (const u of selected) {
    await insertPlayerRow(db, u);
  }
};
