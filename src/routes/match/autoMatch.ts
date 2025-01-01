import { randomInt } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BadRequestError } from 'http-errors-enhanced';
import type { InsertObject } from 'kysely';
import { sql } from 'kysely';
import { z } from 'zod';
import type { DatabaseSchema } from '../../lib/database/schema.js';

type MatchNode = { giftee: number; santa: number };

export const autoMatch: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/auto-match',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      const playersNeedingSanta = await db
        .selectFrom('player')
        .select('id')
        .where('signup_complete', '=', 1)
        .where('giftee_for_count', '=', 0)
        .where('game_mode', '<>', 'Santa Only')
        .orderBy(sql`random()`)
        .execute();

      if (playersNeedingSanta.length < 5) {
        throw new BadRequestError('Can only auto match with 5 or more players');
      }

      const playersThatCanSanata = await db
        .selectFrom('player')
        .select(['id', 'giftee_count', 'max_giftees'])
        .where('signup_complete', '=', 1)
        .where('giftee_count_status', '=', 'can_have_more')
        .orderBy(
          sql`giftee_count - (case when giftee_for_count > 0 then 1 else 0 end) asc`
        )
        .orderBy(sql`random()`)
        .execute();
      const santaQueue = [...playersThatCanSanata];
      const nodes: Array<MatchNode> = [];
      for (const giftee of playersNeedingSanta) {
        const santa = santaQueue.shift();
        if (!santa) break;
        nodes.push({ giftee: giftee.id, santa: santa.id });
        const nextSanta = { ...santa, giftee_count: santa.giftee_count + 1 };
        if (nextSanta.giftee_count < nextSanta.max_giftees) {
          santaQueue.push(nextSanta);
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        let swapWith = -1;
        let invalid = true;
        for (let attempt = 0; attempt < 10 && invalid; attempt++) {
          swapWith = randomInt(nodes.length);
          const previousIndex = (i + nodes.length - 1) % nodes.length;
          const nextIndex = (i + 1) % nodes.length;
          const targetPreviousIndex =
            (swapWith + nodes.length - 1) % nodes.length;
          const targetNextIndex = (swapWith + 1) % nodes.length;

          // g1-s1 g2-s2 g3-s3
          // s1 != g2 && s2 !== g3
          // g2 != s3 && g1 !== s3
          invalid =
            // ensure neither position has either player as their own santa
            nodes[targetPreviousIndex]?.santa === nodes[i]?.giftee ||
            nodes[i]?.santa === nodes[targetNextIndex]?.giftee ||
            nodes[previousIndex]?.santa === nodes[swapWith]?.giftee ||
            nodes[swapWith]?.santa === nodes[nextIndex]?.giftee; //||
          // ensure neither position creates an imediate X is santa for Y and vica versa
          // nodes[targetPreviousIndex]?.giftee === nodes[i]?.santa ||
          // nodes[i]?.giftee === nodes[targetNextIndex]?.santa ||
          // nodes[previousIndex]?.giftee === nodes[swapWith]?.santa ||
          // nodes[swapWith]?.giftee === nodes[nextIndex]?.santa;
        }
        if (invalid) {
          throw new Error('cannot find valid match after 10 attempts');
        }
        const tmp = nodes[i] as MatchNode;
        nodes[i] = nodes[swapWith] as MatchNode;
        nodes[swapWith] = tmp;
      }

      const matches: Array<InsertObject<DatabaseSchema, 'match'>> = [];
      for (let i = 0; i < nodes.length; i++) {
        const current = nodes[i] as MatchNode;
        const next = nodes[(i + 1) % nodes.length] as MatchNode;
        matches.push({
          santa: current.santa,
          giftee: next.giftee,
          has_present: 0,
          invalid_player: 0,
          match_status: 'draft',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
        });
      }

      await db.insertInto('match').values(matches).execute();

      reply.header('HX-Refresh', 'true');
      return reply.code(204).send();
    }
  );
};
