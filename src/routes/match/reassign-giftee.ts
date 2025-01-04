import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const reassignGiftee: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/reassign-giftee',
    {
      schema: {
        body: z.object({
          match_id: z.coerce.number(),
          santa_handle: z.string(),
          super_santa_match: z.enum(['true', 'false']).optional(),
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
        .executeTakeFirstOrThrow();

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
        .where('id', '=', request.body.match_id)
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

      // reply.header(
      //   'HX-Trigger',
      //   JSON.stringify({
      //     'ss-match-deactivated': { id: request.body.match_id },
      //   })
      // );
      // FIXME would prefer to update data
      reply.header('HX-Refresh', 'true');
      return reply.code(204).send();
    }
  );
};
