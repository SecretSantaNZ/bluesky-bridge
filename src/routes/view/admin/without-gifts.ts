import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { queryFullMatch } from '../../../lib/database/index.js';
import type { ExpressionBuilder } from 'kysely';
import type { DatabaseSchema } from '../../../lib/database/schema.js';
import type { OperandExpression } from 'kysely';
import type { SqlBool } from 'kysely';

function filterToInactiveMatches(
  eb: ExpressionBuilder<DatabaseSchema, 'match'>
): OperandExpression<SqlBool> {
  return eb.and([
    eb('match.deactivated', 'is', null),
    eb('match.match_status', '=', 'locked'),
    eb.or([
      eb('match.tracking_count', '=', 0),
      eb('match.tracking_missing_count', '>', 0),
    ]),
    eb('match.nudge_present_update_count', '=', 0),
    eb('match.contacted', 'is', null),
    eb('match.followup_action', 'is', null),
    eb('match.super_santa_match', '=', 0),
  ]);
}

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
      const [playersWhoCanHaveMoreGifees, matches, toMessageCount] =
        await Promise.all([
          db
            .selectFrom('player')
            .select([
              'handle',
              'did',
              'address_location',
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
            .orderBy('match.id asc')
            .execute(),
          db
            .selectFrom('match')
            .select(({ fn }) => fn.countAll().as('cnt'))
            .where((eb) => filterToInactiveMatches(eb))
            .executeTakeFirstOrThrow(),
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
          toMessageCount: toMessageCount.cnt,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );

  app.post(
    '/without-gifts/poke',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;

      const result = await db
        .updateTable('player')
        .set({
          next_player_dm: 'poke-inactive',
          player_dm_status: 'queued',
        })
        .where((eb) =>
          eb(
            'player.id',
            'in',
            eb
              .selectFrom('match')
              .select('match.santa')
              .where((eb) => filterToInactiveMatches(eb))
          )
        )
        .executeTakeFirst();

      return reply.send(`DMs will be sent to ${result.numUpdatedRows} Santas`);
    }
  );
};
