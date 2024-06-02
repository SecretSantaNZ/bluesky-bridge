export interface DatabaseSchema {
  jwt_mac_key: JwtMacKey;
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

export interface AuthRequest {
  post_key: string;
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
  following_santa_uri: string | null;
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
