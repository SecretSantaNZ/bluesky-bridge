export interface DatabaseSchema {
  jwt_mac_key: JwtMacKey;
  jwk_key: JwkKey;
  at_oauth_state: AtOauthState;
  at_oauth_session: AtOauthSession;
  auth_request: AuthRequest;
  message: Message;
  player: Player;
  settings: Settings;
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

export interface AuthRequest {
  request_id: string;
  auth_code: string;
  auth_state: 'pending' | 'authenticated';
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state: string;
  user_did: string;
  started_at: string;
}

export interface Message {
  id: number;
  message_type: string;
  message: string;
}

export interface Player {
  id?: number;
  did: string;
  handle: string;
  profile_complete: number;
  signup_complete: number;
  following_santa_uri: string | null;
  santa_following_uri: string | null;
}

export interface Settings {
  id: number;
  signups_open: number;
  matches_sent_date: string;
  send_by_date: string;
  opening_date: string;
  hashtag: string;
  elf_list: string;
}
