import { randomInt } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BadRequestError } from 'http-errors-enhanced';
import type { InsertObject } from 'kysely';
import { sql } from 'kysely';
import { z } from 'zod';
import type { DatabaseSchema } from '../../../../lib/database/schema.js';

type MatchNode = { giftee: number; santa: number };

export const autoMatch: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/auto-match',
    {
      schema: {
        body: z.object({
          max_post_count_since_signup: z.coerce.number().optional(),
          max_post_count_and: z.coerce.number().optional(),
          max_post_count_threshold: z.coerce.number().optional(),
        }),
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
        .where((eb) =>
          eb.or([
            eb('post_count', '<', request.body.max_post_count_threshold || -1),
            eb.and([
              eb(
                'post_count_since_signup',
                '<',
                request.body.max_post_count_since_signup ||
                  Number.MAX_SAFE_INTEGER
              ),
              eb(
                'post_count',
                '<',
                request.body.max_post_count_and || Number.MAX_SAFE_INTEGER
              ),
            ]),
          ])
        )
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
        .where((eb) =>
          eb.or([
            eb('post_count', '<', request.body.max_post_count_threshold || -1),
            eb.and([
              eb(
                'post_count_since_signup',
                '<',
                request.body.max_post_count_since_signup ||
                  Number.MAX_SAFE_INTEGER
              ),
              eb(
                'post_count',
                '<',
                request.body.max_post_count_and || Number.MAX_SAFE_INTEGER
              ),
            ]),
          ])
        )
        .orderBy(
          sql`giftee_count - (case when giftee_for_count > 0 then 1 else 0 end)`,
          'asc'
        )
        .orderBy(
          sql`case when game_mode = 'Santa Only' and giftee_count = 0 then 1 else giftee_count end`,
          'asc'
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

      const deactivatedMatches = await db
        .selectFrom('match')
        .select(['santa', 'giftee'])
        .where('deactivated', 'is not', null)
        .execute();
      const forbiddenMatches = deactivatedMatches.reduce<
        Record<number, Set<number>>
      >((acc, match) => {
        const set = acc[match.santa] ?? new Set<number>();
        acc[match.santa] = set;
        set.add(match.giftee);
        return acc;
      }, {});

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

          const currentLeftSanta = nodes[previousIndex]?.santa as number;
          const currentLeftGiftee = nodes[i]?.giftee as number;
          const currentRightSanta = nodes[i]?.santa as number;
          const currentRightGiftee = nodes[nextIndex]?.giftee as number;

          const targetLeftSanta = nodes[targetPreviousIndex]?.santa as number;
          const targetLeftGiftee = nodes[swapWith]?.giftee as number;
          const targetRightSanta = nodes[swapWith]?.santa as number;
          const targetRightGiftee = nodes[targetNextIndex]?.giftee as number;

          invalid =
            // Ensure moving current node to swap to won't make either player
            // their own santa
            targetLeftSanta === currentLeftGiftee ||
            currentRightSanta === targetRightGiftee ||
            // Ensure moving target node to current position won't make either
            // player their own santa
            currentLeftSanta === targetLeftGiftee ||
            targetRightSanta === currentRightGiftee ||
            // Ensure moving current node to swap to won't make a match that is already deactivated
            forbiddenMatches[targetLeftSanta]?.has(currentLeftGiftee) ||
            forbiddenMatches[currentRightSanta]?.has(targetRightGiftee) ||
            // Ensure moving target node to current index won't make a match that is already deactivated
            forbiddenMatches[currentLeftSanta]?.has(targetLeftGiftee) ||
            forbiddenMatches[targetRightSanta]?.has(currentRightGiftee) ||
            // ensure neither position creates an immediate X is santa for Y and vica versa
            // .A -> BB -> A.
            (currentLeftSanta === currentRightGiftee &&
              targetLeftGiftee === targetRightSanta) ||
            (targetLeftSanta === targetRightGiftee &&
              currentLeftGiftee === currentRightSanta);
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

      if (matches.length > 0) {
        await db.insertInto('match').values(matches).execute();
      }

      return reply.redirect('/admin/draft-matches', 303);
    }
  );
};
