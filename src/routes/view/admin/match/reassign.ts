import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { queryFullMatch } from '../../../../lib/database/match.js';
import { loadPlayersWhoCanHaveMoreGifees } from '../../../../lib/database/loadPlayersWhoCanHaveMoreGifees.js';
import type { Database } from '../../../../lib/database/index.js';

async function renderReassign(
  db: Database,
  reply: FastifyReply,
  match_id: number,
  status = 200,
  extra: Record<string, unknown> = {}
) {
  const [match, playersWhoCanHaveMoreGifees] = await Promise.all([
    queryFullMatch(db)
      .where('match.id', '=', match_id)
      .executeTakeFirstOrThrow(),
    loadPlayersWhoCanHaveMoreGifees(db),
  ]);

  return reply.status(status).view('admin/match/reassign.njk', {
    ...extra,
    match,
    playersWhoCanHaveMoreGifees,
  });
}

export type ReassignParams = {
  match_id: number;
  santa_handle: string;
  super_santa_match?: 'true' | 'false' | undefined;
  force?: 'true' | 'false' | undefined;
};

export type ReassignOutcome =
  | { ok: true; superSantaMatch: boolean }
  | {
      ok: false;
      status: 409;
      error: 'santa-not-found' | 'too-many-giftees';
    };

/** Deactivates the old match (or flags it for super-santa followup) and
 *  creates a replacement match for the giftee with the requested santa. */
export async function reassignMatch(
  db: Database,
  { match_id, santa_handle, super_santa_match, force }: ReassignParams
): Promise<ReassignOutcome> {
  const player = await db
    .selectFrom('player')
    .selectAll()
    .where('deactivated', '=', 0)
    .where('handle', '=', santa_handle)
    .executeTakeFirst();

  if (player == null) {
    return { ok: false, status: 409, error: 'santa-not-found' };
  }

  if (player.giftee_count_status != 'can_have_more' && force !== 'true') {
    return { ok: false, status: 409, error: 'too-many-giftees' };
  }

  const oldMatch = await db
    .updateTable('match')
    .set(
      super_santa_match === 'true'
        ? {
            followup_action: 'super-assigned',
          }
        : {
            deactivated: new Date().toISOString(),
          }
    )
    .where('id', '=', match_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto('match')
    .values({
      santa: player.id,
      giftee: oldMatch.giftee,
      has_present: 0,
      invalid_player: 0,
      match_status: super_santa_match === 'true' ? 'locked' : 'draft',
      nudge_count: 0,
      nudge_present_update_count: 0,
      tracking_count: 0,
      tracking_missing_count: 0,
      super_santa_match: super_santa_match === 'true' ? 1 : 0,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { ok: true, superSantaMatch: super_santa_match === 'true' };
}

export const reassign: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/:match_id/reassign',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
        querystring: z
          .object({
            super_santa_match: z.enum(['true', 'false']),
          })
          .partial(),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      return renderReassign(
        db,
        reply,
        request.params.match_id,
        200,
        request.query
      );
    }
  );

  app.post(
    '/:match_id/reassign',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
        body: z.object({
          santa_handle: z.string(),
          super_santa_match: z.enum(['true', 'false']).optional(),
          force: z.enum(['true', 'false']).optional(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      const outcome = await reassignMatch(db, {
        match_id: request.params.match_id,
        ...request.body,
      });

      if (!outcome.ok) {
        const error =
          outcome.error === 'santa-not-found'
            ? 'santa-not-found'
            : 'too-many-giftees';
        return renderReassign(db, reply, request.params.match_id, 409, {
          ...request.body,
          reassignError: error,
        });
      }

      if (outcome.superSantaMatch) {
        return reply.redirect('/admin/without-gifts', 303);
      }

      return reply.redirect('/admin/fix-matches', 303);
    }
  );
};
