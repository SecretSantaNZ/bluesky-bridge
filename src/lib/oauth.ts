import { randomBytes } from 'crypto';
import base64url from 'base64url';
import { BadRequestError, UnauthorizedError } from 'http-errors-enhanced';
import { subMinutes, formatISO } from 'date-fns';
import bcrypt from 'bcrypt';
import type { Database } from './database/index.js';

export type OauthClient = {
  client_id: string;
  client_secret_hash: string;
  redirectUris: Set<string>;
};

const AUTH_TIMEOUT_MINUTES = 5;

export class OauthSessionStore {
  private readonly oauthClients: Record<string, OauthClient> = {};

  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private db: Database) {
    this.cleanupInterval = setInterval(async () => {
      const removeBefore = formatISO(
        subMinutes(new Date(), AUTH_TIMEOUT_MINUTES)
      );
      await this.db
        .deleteFrom('auth_request')
        .where('started_at', '<', removeBefore)
        .execute();
    }, 60000);
  }

  registerClient(client: OauthClient) {
    this.oauthClients[client.client_id] = client;
  }

  async authenticateClient(clientId: string, clientSecret: string) {
    const client = this.oauthClients[clientId];
    return client != null
      ? bcrypt.compare(clientSecret, client.client_secret_hash)
      : false;
  }

  async startAuth(opts: {
    client_id: string;
    redirect_uri: string;
    scope?: string;
    state: string;
  }) {
    const client = this.oauthClients[opts.client_id];
    if (client == null) {
      throw new BadRequestError(`Unknown client ${opts.client_id}`);
    }
    if (!client.redirectUris.has(opts.redirect_uri)) {
      throw new BadRequestError(
        `Redirect url ${opts.redirect_uri} is not allowed for client ${opts.client_id}`
      );
    }

    const post_key = base64url.default.encode(randomBytes(9));
    const auth_code = base64url.default.encode(randomBytes(9));

    await this.db
      .insertInto('auth_request')
      .values({
        post_key,
        auth_code,
        auth_state: 'pending',
        client_id: opts.client_id,
        redirect_uri: opts.redirect_uri,
        scope: opts.scope,
        state: opts.state,
        user_did: '',
        started_at: formatISO(new Date()),
      })
      .execute();

    return post_key;
  }

  async keyPostSeen(postKey: string, userDid: string) {
    await this.db
      .updateTable('auth_request')
      .set('user_did', userDid)
      .set('auth_state', 'authenticated')
      .where('post_key', '=', postKey)
      // Only update if pending to ensure that a subsequent post
      // of the secret doesn't allow someone else to take over
      .where('auth_state', '=', 'pending')
      .execute();
  }

  async getAuthCodeForPostKey(postKey: string) {
    const authentication = await this.db
      .selectFrom('auth_request')
      .selectAll()
      .where('post_key', '=', postKey)
      .where('auth_state', '=', 'authenticated')
      .where(
        'started_at',
        '>',
        formatISO(subMinutes(new Date(), AUTH_TIMEOUT_MINUTES))
      )
      .executeTakeFirst();

    if (authentication == null) {
      throw new UnauthorizedError();
    }

    return authentication;
  }

  async completeAuth(
    client_id: string,
    opts: {
      grant_type: string;
      code: string;
      redirect_uri: string;
    }
  ) {
    if (opts.grant_type !== 'authorization_code') {
      throw new BadRequestError(
        `Bad grant type, only 'authorization_code' is supported`
      );
    }

    const client = this.oauthClients[client_id];
    if (client == null) {
      throw new UnauthorizedError(`Unknown client`);
    }

    const authentication = await this.db
      .deleteFrom('auth_request')
      .where('auth_code', '=', opts.code)
      .where('auth_state', '=', 'authenticated')
      .where(
        'started_at',
        '>',
        formatISO(subMinutes(new Date(), AUTH_TIMEOUT_MINUTES))
      )
      .returningAll()
      .executeTakeFirst();

    if (authentication == null) {
      throw new UnauthorizedError(`Unknown code for client`);
    }

    if (authentication.redirect_uri !== opts.redirect_uri) {
      throw new BadRequestError(`redirect_url does not match`);
    }

    return authentication;
  }
}
