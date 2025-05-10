import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as dateUtils from '../../../lib/dates.js';

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
      const baseQuery = db
        .selectFrom('player')
        .selectAll('player')
        .select((eb) =>
          eb
            .selectFrom('player_badge')
            .select(({ fn }) => fn.countAll<number>().as('badge_count'))
            .whereRef('player_badge.player_did', '=', 'player.did')
            .as('badge_count')
        )
        .orderBy('id asc');
      if (request.query.player_did && request.headers['hx-request']) {
        const player = await baseQuery
          .where('player.did', '=', request.query.player_did)
          .executeTakeFirstOrThrow();
        return reply.send(player);
      }
      const players = await baseQuery.execute();
      return reply.view(
        'admin/manage-players.ejs',
        {
          ...dateUtils,
          players,
          initialFilter: request.query.handle ?? '',
          replaceUrl: request.routeOptions.url,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );
};
