import type { GeneratedAlways, Generated } from 'kysely';

export interface DatabaseSchema {
  jwt_mac_key: JwtMacKey;
  jwk_key: JwkKey;
  at_oauth_state: AtOauthState;
  at_oauth_session: AtOauthSession;
  mastodon_client: MastodonClient;
  message: Message;
  player: Player;
  match: Match;
  nudge_type: NudgeType;
  nudge_greeting: NudgeGreeting;
  nudge_type_greeting: NudgeTypeGreeting;
  nudge_signoff: NudgeSignoff;
  nudge_type_signoff: NudgeTypeSignoff;
  nudge: Nudge;
  carrier: Carrier;
  tracking: Tracking;
  settings: Settings;
  post: Post;
  mastodon_token: MastodonToken;
  note: Note;
}

export interface JwtMacKey {
  kid: string;
  audience: string;
  key_bytes: Buffer;
  created_at: string;
}

export interface JwkKey {
  kid: string;
  jwk_json: string;
  created_at: string;
}

export interface AtOauthState {
  key: string;
  data: string;
  created_at: string;
}

export interface AtOauthSession {
  key: string;
  data: string;
  created_at: string;
}

export interface Message {
  id: Generated<number>;
  message_type: string;
  message: string;
}

export interface Player {
  id: GeneratedAlways<number>;
  did: string;
  admin: Generated<number>;
  handle: string;
  avatar_url?: string;
  profile_complete: number;
  signup_complete: number;
  following_santa_uri: string | null;
  santa_following_uri: string | null;
  address: string | null;
  address_review_required: string | null;
  delivery_instructions: string | null;
  game_mode: null | 'Regular' | 'Super Santa' | 'Santa Only' | 'Giftee Only';
  max_giftees: number;
  giftee_for_count: Generated<number>;
  locked_giftee_for_count: Generated<number>;
  giftee_count: Generated<number>;
  giftee_count_status: Generated<'can_have_more' | 'full' | 'too_many'>;
  opted_out: string | null;
  booted: string | null;
  booted_by?: string | null;
  deactivated: GeneratedAlways<number>;
  next_player_dm: Generated<
    | null
    | 'signup-complete-1'
    | 'signup-complete-2'
    | 'signup-complete-3'
    | 'poke-inactive'
  >;
  next_player_dm_after: Generated<string | null>;
  player_dm_status: Generated<'queued' | 'sent' | `error: ${string}`>;
  player_type: 'bluesky' | 'mastodon';
  mastodon_account: Generated<string | null>;
  mastodon_host: Generated<string | null>;
  mastodon_id: Generated<string | null>;
  mastodon_following_santa: Generated<null | 0 | 1>;
  mastodon_followed_by_santa: Generated<null | 0 | 1>;
  mastodon_follow_last_checked: Generated<null | string>;
  note_count: Generated<number>;
}

export interface Match {
  id: GeneratedAlways<number>;
  santa: number;
  giftee: number;
  deactivated: Generated<string | null>;
  has_present: number;
  invalid_player: number;
  match_status: 'draft' | 'shared' | 'locked';
  dm_handle_status: Generated<'queued' | 'sent' | `error: ${string}`>;
  dm_address_status: Generated<'queued' | 'sent' | `error: ${string}`>;
  nudge_count: number;
  nudge_present_update_count: number;
  tracking_count: number;
  tracking_missing_count: number;
  contacted: Generated<null | string>;
  followup_action: Generated<null | 'super-assigned' | 'sorted'>;
  super_santa_match: Generated<number>;
}

export interface NudgeType {
  id: Generated<number>;
  name: string;
  order_index: number;
}

export interface NudgeGreeting {
  id: GeneratedAlways<number>;
  text: string;
}

export interface NudgeTypeGreeting {
  nudge_type: number;
  greeting: number;
}

export interface NudgeSignoff {
  id: GeneratedAlways<number>;
  text: string;
}

export interface NudgeTypeSignoff {
  nudge_type: number;
  signoff: number;
}

export interface Nudge {
  id: GeneratedAlways<number>;
  nudge_type: number;
  nudge_greeting: number;
  nudge_signoff: number;
  match: number;
  nudge_status: 'queued' | 'sent' | `error: ${string}`;
  post_url: Generated<null | string>;
  created_at: string;
  created_by: string;
}

export interface Carrier {
  id: GeneratedAlways<number>;
  text: string;
}

export interface Tracking {
  id: GeneratedAlways<number>;
  carrier: number;
  shipped_date: string;
  tracking_number: string;
  giftwrap_status: number;
  missing: string | null;
  match: number;
  tracking_status: 'queued' | 'sent' | `error: ${string}`;
  created_at: string;
  created_by: string;
  deactivated: Generated<string | null>;
}

export interface Settings {
  id: number;
  signups_open: number;
  mastodon_players: 0 | 1;
  signups_open_date: string;
  signups_close_date: string;
  matches_sent_date: string;
  send_by_date: string;
  opening_date: string;
  hashtag: string;
  elf_list: string;
  nudge_rate: string;
  dm_rate: string;
  auto_follow: number;
  send_messages: number;
  feed_player_only: 0 | 1;
  feed_max_distance_from_tag: number;
}

export type Post = {
  uri: string;
  author: string;
  replyParent: string | null;
  replyParentAuthor: string | null;
  indexedAt: string;
  time_us: number;

  hasHashtag: 0 | 1;
  byPlayer: 0 | 1;

  distanceFromHashtag: number;
  distanceFromPlayerWithHashtag: number;

  rootByPlayerWithHashtag: 0 | 1;
};

export type MastodonClient = {
  instance: string;
  client_id: string;
  client_secret: string;
};

export type MastodonToken = {
  account: string;
  mastodon_id: string;
  token: string;
  client_id: string;
  issued_at: string;
};

export type Note = {
  id: GeneratedAlways<number>;
  player_id: number;
  text: string;
  author: string;
  created_at: string;
};
