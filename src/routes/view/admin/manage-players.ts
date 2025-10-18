import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../../lib/database/index.js';

export function baseAdminPlayerQuery(db: Database) {
  return db
    .selectFrom('player')
    .selectAll('player')
    .select((eb) =>
      eb
        .selectFrom('player_badge')
        .select(({ fn }) => fn.countAll<number>().as('badge_count'))
        .whereRef('player_badge.player_did', '=', 'player.did')
        .as('badge_count')
    );
}

export const managePlayers: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/manage-players',
    {
      schema: {
        querystring: z
          .object({ handle: z.string(), player_did: z.string() })
          .partial(),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      const baseQuery = baseAdminPlayerQuery(db).orderBy('id', 'asc');
      const players = await baseQuery.execute();
      return reply.view('admin/manage-players', {
        players,
        initialFilter: request.query.handle ?? '',
        replaceUrl: request.routeOptions.url,
      });
    }
  );
};
