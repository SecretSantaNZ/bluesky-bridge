import { randomBytes, timingSafeEqual } from 'crypto';
import base64url from 'base64url';
import { BadRequestError, UnauthorizedError } from 'http-errors-enhanced';
import { subMinutes, isBefore } from 'date-fns';
import bcrypt from 'bcrypt';

export type OauthClient = {
  client_id: string;
  client_secret_hash: string;
  redirectUris: Set<string>;
};

export type AuthRequest = {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  startedAt: Date;
  step: 'waiting-for-post' | 'authenticated';
  userDid: string;
};

type AuthRequestWithCode = AuthRequest & { code: string };

export class OauthSessionStore {
  private readonly oauthClients: Record<string, OauthClient> = {};

  private readonly inflightAuth: Record<string, AuthRequest> = {};
  private readonly codeAssigned: Record<string, AuthRequestWithCode> = {};

  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      const removeBefore = subMinutes(new Date(), 5);
      for (const [key, { startedAt }] of Object.entries(this.inflightAuth)) {
        if (isBefore(startedAt, removeBefore)) {
          delete this.inflightAuth[key];
        }
      }
      for (const [key, { startedAt }] of Object.entries(this.codeAssigned)) {
        if (isBefore(startedAt, removeBefore)) {
          delete this.codeAssigned[key];
        }
      }
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
    scope: string;
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
    const keyBytes = randomBytes(9);
    const key = base64url.default.encode(keyBytes);

    this.inflightAuth[key] = {
      ...opts,
      step: 'waiting-for-post',
      startedAt: new Date(),
      userDid: '',
    };

    return `${key}`;
  }

  async keyPostSeen(postKey: string, userDid: string) {
    const authentication = this.inflightAuth[postKey];
    if (authentication != null) {
      authentication.userDid = userDid;
      authentication.step = 'authenticated';
    }
  }

  async getAuthCodeForPostKey(postKey: string) {
    const authentication = this.inflightAuth[postKey];
    if (
      authentication == null ||
      authentication.step !== 'authenticated' ||
      isBefore(authentication.startedAt, subMinutes(new Date(), 5))
    ) {
      throw new UnauthorizedError();
    }
    const codeBytes = randomBytes(9);
    const code = base64url.default.encode(codeBytes);
    delete this.inflightAuth[postKey];
    const authRequestWithCode = { ...authentication, code };
    this.codeAssigned[code] = authRequestWithCode;
    return authRequestWithCode;
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

    const authentication = this.codeAssigned[opts.code];
    if (authentication == null) {
      throw new UnauthorizedError(`Unknown code for client`);
    }

    if (authentication.redirect_uri !== opts.redirect_uri) {
      throw new BadRequestError(`redirect_url does not match`);
    }

    return authentication;
  }
}
