import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ForbiddenError } from 'http-errors-enhanced';
import { z } from 'zod';
import type { Player } from '../../lib/PlayerService.js';

export const assignSanta: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/assign-santa',
    {
      schema: {
        body: z.object({
          santa_handle: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      if (!request.tokenData?.admin) {
        throw new ForbiddenError();
      }
      const { db } = app.blueskyBridge;

      const [santa, giftee] = await Promise.all([
        db
          .selectFrom('player')
          .selectAll()
          .where('deactivated', '=', 0)
          .where('handle', '=', request.body.santa_handle)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('player')
          .selectAll()
          .where('deactivated', '=', 0)
          .where('did', '=', request.playerDid as string)
          .executeTakeFirstOrThrow(),
      ]);

      await db
        .insertInto('match')
        .values({
          santa: santa.id,
          giftee: giftee.id,
          has_present: 0,
          invalid_player: 0,
          match_status: 'draft',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
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
