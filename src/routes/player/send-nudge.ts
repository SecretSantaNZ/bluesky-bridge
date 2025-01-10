import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, InternalServerError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const sendNudge: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/send-nudge',
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
      const admin = request.tokenData?.admin;
      const [match] = await Promise.all([
        admin
          ? undefined
          : db
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
      if (!admin) {
        if (match == null || match.nudge_count >= 5) {
          throw new BadRequestError(`Already 5 nudges for ${match_id}`);
        }
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

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
