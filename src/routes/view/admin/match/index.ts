import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { baseAdminPlayerQuery } from '../manage-players.js';
import { autoMatch } from './autoMatch.js';
import { publish } from './publish.js';
import { nudges } from './nudges.js';
import { tracking } from './tracking.js';
import { deleteDrafts } from './delete-drafts.js';

export const match: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  await app.register(autoMatch);
  await app.register(publish);
  await app.register(nudges);
  await app.register(tracking);
  await app.register(deleteDrafts);

  app.post(
    '/:match_id/deactivate',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const match_id = request.params.match_id;
      const { db } = this.blueskyBridge;

      await db
        .updateTable('match')
        .set({
          deactivated: new Date().toISOString(),
        })
        .where('id', '=', match_id)
        .execute();

      const players = await baseAdminPlayerQuery(db)
        .leftJoin('match as santa_match', 'santa_match.santa', 'player.id')
        .leftJoin('match as giftee_match', 'giftee_match.giftee', 'player.id')
        .where((eb) =>
          eb.or([
            eb('santa_match.id', '=', match_id),
            eb('giftee_match.id', '=', match_id),
          ])
        )
        .execute();
      return reply.nunjucks('common/server-events', {
        playerEvents: players.map((player) => ({ updated: player })),
        matchEvents: [
          {
            deactivated: { match_id },
          },
        ],
      });
    }
  );
};
