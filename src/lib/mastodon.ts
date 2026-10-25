/* v8 ignore start */
/* Thin wrappers around external services; exercised via mocks in tests. */
import { z } from 'zod';
import { w } from './httpClient.js';

type MastodonRelationship = {
  id: string;
  following: boolean;
  followed_by: boolean;
  requested: boolean;
};

export const fetchMastodonRelationships = async (
  host: string,
  token: string,
  mastodonIds: string[]
): Promise<MastodonRelationship[]> => {
  const relationshipsUrl = new URL(
    '/api/v1/accounts/relationships',
    `https://${host}`
  );
  for (const mastodon_id of mastodonIds) {
    relationshipsUrl.searchParams.append('id[]', mastodon_id);
  }
  const relationships = z
    .array(
      z.object({
        id: z.string(),
        following: z.boolean(),
        followed_by: z.boolean(),
        requested: z.boolean(),
      })
    )
    .parse(
      await w
        .headers({
          Authorization: `Bearer ${token}`,
        })
        .get(relationshipsUrl.href)
        .json()
    );
  return relationships;
};

export const lookupMastodonAccount = async (
  host: string,
  acct: string
): Promise<{ id: string }> => {
  const lookupUrl = new URL('/api/v1/accounts/lookup', `https://${host}`);
  lookupUrl.searchParams.set('acct', acct);
  const result = z
    .object({ id: z.string() })
    .parse(await w.get(lookupUrl.href).json());
  return result;
};

export const followMastodonAccount = async (
  host: string,
  token: string,
  mastodonId: string
): Promise<void> => {
  await w
    .auth(`Bearer ${token}`)
    .url(
      new URL(`/api/v1/accounts/${mastodonId}/follow`, `https://${host}`).href
    )
    .post()
    .json();
};
/* v8 ignore stop */
