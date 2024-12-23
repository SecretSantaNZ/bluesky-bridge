import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.addHook('preValidation', async function (request) {
    if (request.method === 'GET') return;
    if (request.method === 'OPTIONS') return;
    const { csrfToken } = z
      .object({ csrfToken: z.string() })
      .parse(request.body);
    if (csrfToken !== request.tokenData?.csrfToken || !csrfToken) {
      throw new BadRequestError('invalid csrf token');
    }
  });

  app.post(
    '/update-address',
    {
      schema: {
        body: z.object({
          address: z.string(),
          delivery_instructions: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      const { address } = request.body;
      const did = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        ...request.body,
        address_review_required:
          address == null ? undefined : !address.match(/new zealand|aotearoa/i),
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );

  app.post(
    '/update-game-mode',
    {
      schema: {
        body: z.object({
          game_mode: z.enum(['Regular', 'Super Santa']),
          max_giftees: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { game_mode, max_giftees } = request.body;
      const did = request.tokenSubject as string;
      if (game_mode === 'Super Santa' && (!max_giftees || max_giftees < 2)) {
        throw new BadRequestError(
          'Must opt in to at least 2 giftees if super santa'
        );
      }
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        ...request.body,
        ...(request.body.game_mode === 'Regular'
          ? { max_giftees: 1 }
          : undefined),
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );

  app.post(
    '/opt-out',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        opted_out: true,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );

  app.post(
    '/opt-in',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        opted_out: false,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );

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
      const [match] = await Promise.all([
        await db
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
      if (match.nudge_count >= 5) {
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

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
