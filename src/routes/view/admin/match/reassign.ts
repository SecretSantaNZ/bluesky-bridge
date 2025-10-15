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

      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('deactivated', '=', 0)
        .where('handle', '=', request.body.santa_handle)
        .executeTakeFirst();

      if (player == null) {
        return renderReassign(db, reply, request.params.match_id, 409, {
          ...request.body,
          reassignError: 'santa-not-found',
        });
      }

      if (
        player.giftee_count_status != 'can_have_more' &&
        request.body.force !== 'true'
      ) {
        return renderReassign(db, reply, request.params.match_id, 409, {
          ...request.body,
          reassignError: 'too-many-giftees',
        });
      }

      const oldMatch = await db
        .updateTable('match')
        .set(
          request.body.super_santa_match === 'true'
            ? {
                followup_action: 'super-assigned',
              }
            : {
                deactivated: new Date().toISOString(),
              }
        )
        .where('id', '=', request.params.match_id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .insertInto('match')
        .values({
          santa: player.id,
          giftee: oldMatch.giftee,
          has_present: 0,
          invalid_player: 0,
          match_status:
            request.body.super_santa_match === 'true' ? 'locked' : 'draft',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
          super_santa_match: request.body.super_santa_match === 'true' ? 1 : 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (request.body.super_santa_match) {
        return reply.redirect('/admin/without-gifts', 303);
      }

      return reply.redirect('/admin/fix-matches', 303);
    }
  );
};
