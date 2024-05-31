export interface DatabaseSchema {
  jwt_mac_key: JwtMacKey;
  auth_request: AuthRequest;
  message: Message;
  player: Player;
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
  following_santa: number;
}
