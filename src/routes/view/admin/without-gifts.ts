import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { queryFullMatch } from '../../../lib/database/index.js';

export const withoutGifts: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/without-gifts',
    {
      schema: {
        querystring: z
          .object({
            data: z.enum(['true', 'false']),
          })
          .partial(),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      const [playersWhoCanHaveMoreGifees, matches] = await Promise.all([
        db
          .selectFrom('player')
          .select([
            'handle',
            'did',
            'avatar_url',
            'note_count',
            'giftee_count',
            'giftee_for_count',
            'max_giftees',
          ])
          .where('giftee_count_status', '=', 'can_have_more')
          .where('signup_complete', '=', 1)
          .orderBy(
            sql`giftee_count - (case when giftee_for_count > 0 then 1 else 0 end) asc`
          )
          .orderBy('giftee_count')
          .orderBy(sql`random()`)
          .execute(),
        queryFullMatch(db)
          .where('match.match_status', '=', 'locked')
          .where((eb) =>
            eb.or([
              eb('match.tracking_count', '=', 0),
              eb('match.tracking_missing_count', '>', 0),
            ])
          )
          .orderBy('match.id asc')
          .execute(),
      ]);
      const pageData = {
        playersWhoCanHaveMoreGifees,
        matches,
      };
      if (request.query.data === 'true') {
        return reply.send(pageData);
      }
      return reply.view(
        'admin/without-gifts.ejs',
        {
          pageData,
          oneColumn: true,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );
};
