import { JoseKey } from '@atproto/jwk-jose';
import type { Database } from './database/index.js';
import { generateKeyPair as generateKeyPairCB, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { AtOauthState, JwkKey } from './database/schema.js';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import type { SimpleStore, Value } from '@atproto-labs/simple-store';
import AsyncLock from 'async-lock';

const generateKeyPair = promisify(generateKeyPairCB);

export function buildStore<D extends Value>(
  database: Database,
  table: 'at_oauth_state' | 'at_oauth_session'
): SimpleStore<string, D> {
  return {
    async set(key: string, internalState: D): Promise<void> {
      const record: Omit<AtOauthState, 'key'> = {
        data: JSON.stringify(internalState),
        created_at: new Date().toISOString(),
      };
      await database
        .insertInto(table)
        .values({
          key,
          ...record,
        })
        .onConflict((oc) => oc.column('key').doUpdateSet(record))
        .executeTakeFirstOrThrow();
    },
    async get(key: string): Promise<D | undefined> {
      const record = await database
        .selectFrom(table as 'at_oauth_state')
        .selectAll()
        .where('key', '=', key)
        .executeTakeFirst();
      return record == null ? undefined : JSON.parse(record.data);
    },
    async del(key: string): Promise<void> {
      await database
        .deleteFrom(table as 'at_oauth_state')
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
    },
  };
}

export async function initAtLoginClient({
  database,
  basePath,
}: {
  database: Database;
  basePath: string;
}) {
  const keys = await database.selectFrom('jwk_key').selectAll().execute();

  const lock = new AsyncLock();

  const keysToAdd = Math.max(3 - keys.length, 0);
  for (let i = 0; i < keysToAdd; i++) {
    const keyPair = await generateKeyPair('ec', {
      namedCurve: 'prime256v1',
    });
    const jwk = {
      kid: randomUUID(),
      ...keyPair.privateKey.export({ format: 'jwk' }),
    };
    const record: JwkKey = {
      kid: jwk.kid,
      jwk_json: JSON.stringify(jwk),
      created_at: new Date().toISOString(),
    };
    await database
      .insertInto('jwk_key')
      .values(record)
      .executeTakeFirstOrThrow();
    keys.push(record);
  }

  return new NodeOAuthClient({
    clientMetadata: {
      client_id: `${basePath}/client-metadata.json`,
      client_name: 'Secret Santa NZ',
      client_uri: `${basePath}`,
      // logo_uri: `${basePath}/logo.png`,
      // tos_uri: `${basePath}/tos`,
      // policy_uri: `${basePath}/policy`,
      redirect_uris: [`${basePath}/atproto-oauth-callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      jwks_uri: `${basePath}/jwks.json`,
      scope: 'atproto transition:generic transition:chat.bsky',
    },
    keyset: await Promise.all(
      keys.map(({ jwk_json }) => JoseKey.fromImportable(jwk_json))
    ),
    stateStore: buildStore(database, 'at_oauth_state'),
    sessionStore: buildStore(database, 'at_oauth_session'),
    requestLock: (key, fn) => lock.acquire(key, fn),
  });
}
