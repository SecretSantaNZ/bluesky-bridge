import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Player } from '../../../../lib/PlayerService.js';
import { NotFoundError } from 'http-errors-enhanced';
import { baseAdminPlayerQuery } from '../manage-players.js';
import { queryFullMatch } from '../../../../lib/database/match.js';

export const notes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/notes',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db, playerService } = this.blueskyBridge;
      const [player, notes, adminPlayer, affectedMatches] = await Promise.all([
        playerService.getPlayerById(request.params.player_id),
        db
          .selectFrom('note')
          .innerJoin('player', 'player.did', 'note.player_did')
          .select(['note.id', 'note.text', 'note.author', 'note.created_at'])
          .where('player.id', '=', request.params.player_id)
          .orderBy('note.created_at', 'desc')
          .execute(),
        baseAdminPlayerQuery(db)
          .where('player.id', '=', request.params.player_id)
          .executeTakeFirstOrThrow(),
        queryFullMatch(db)
          .where((eb) =>
            eb.or([
              eb('santa.id', '=', request.params.player_id),
              eb('giftee.id', '=', request.params.player_id),
            ])
          )
          .execute(),
      ]);

      return reply.nunjucks('admin/player/notes', {
        player,
        notes,
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
        matchEvents: affectedMatches.map((match) => ({ updated: match })),
      });
    }
  );

  app.post(
    '/notes',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({
          note_text: z.string(),
        }),
      },
    },
    async function (request, reply) {
      const author = reply.locals?.player as Player;
      const player = await this.blueskyBridge.playerService.getPlayerById(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }

      await this.blueskyBridge.db
        .insertInto('note')
        .values({
          player_did: player.did,
          author: author.handle,
          text: request.body.note_text,
          created_at: new Date().toISOString(),
        })
        .execute();

      return reply.redirect(`/admin/player/${player.id}/notes`);
    }
  );
};
