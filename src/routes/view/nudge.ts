import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
import { queryFullMatch } from '../../lib/database/match.js';
import { BadRequestError, InternalServerError } from 'http-errors-enhanced';
import { loadNudgeOptions } from '../../lib/database/nudge.js';

export const nudge: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/match/:match_id/send-nudge',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = this.blueskyBridge;
      const did = request.tokenSubject as string;

      const [match, { nudgeTypes, nudgeGreetings, nudgeSignoffs }] =
        await Promise.all([
          queryFullMatch(db)
            .where('match.id', '=', request.params.match_id)
            .where('santa.did', '=', did)
            .executeTakeFirstOrThrow(),
          loadNudgeOptions(db),
        ]);

      return reply.nunjucks('player/send-nudge', {
        match,
        nudgeTypes,
        nudgeOptions: {
          nudge_type: nudgeTypes[0]?.id,
          nudgeGreetings,
          nudgeSignoffs,
        },
      });
    }
  );

  app.post(
    '/nudge',
    {
      schema: {
        body: z.object({
          match_id: z.coerce.number(),
          nudge_type: z.coerce.number(),
          nudge_greeting: z.coerce.number(),
          nudge_signoff: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { match_id, nudge_type, nudge_greeting, nudge_signoff } =
        request.body;
      const did = request.tokenSubject as string;
      const { db, playerService } = this.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new InternalServerError(`Player not found ${did}`);
      }

      console.log({
        pid: player.id,
        match_id,
        nudge_type,
        nudge_greeting,
        nudge_signoff,
      });
      const [match] = await Promise.all([
        db
          .selectFrom('match')
          .selectAll()
          .where('santa', '=', player.id)
          .where('id', '=', match_id)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('nudge_type')
          .selectAll()
          .where('id', '=', nudge_type)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('nudge_greeting')
          .innerJoin(
            'nudge_type_greeting',
            'nudge_greeting.id',
            'nudge_type_greeting.greeting'
          )
          .selectAll()
          .where('id', '=', nudge_greeting)
          .where('nudge_type_greeting.nudge_type', '=', nudge_type)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('nudge_signoff')
          .selectAll()
          .innerJoin(
            'nudge_type_signoff',
            'nudge_signoff.id',
            'nudge_type_signoff.signoff'
          )
          .selectAll()
          .where('id', '=', nudge_signoff)
          .where('nudge_type_signoff.nudge_type', '=', nudge_type)
          .executeTakeFirstOrThrow(),
      ]);
      if (match == null || match.nudge_count >= 5) {
        throw new BadRequestError(`Already 5 nudges for ${match_id}`);
      }
      await db
        .insertInto('nudge')
        .values({
          nudge_type,
          nudge_greeting,
          nudge_signoff,
          match: match_id,
          nudge_status: 'queued',
          created_at: new Date().toISOString(),
          created_by: did,
        })
        .execute();

      return reply.redirect('/', 303);
    }
  );
};
