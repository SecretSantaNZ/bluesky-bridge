import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as dateUtils from '../../../../lib/dates.js';
import type { Player } from '../../../../lib/PlayerService.js';
import { NotFoundError } from 'http-errors-enhanced';

export const playerNotes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/player-notes',
    {
      schema: {
        querystring: z.object({
          player_did: z.string(),
        }),
      },
    },
    async function (request, reply) {
      const notes = await this.blueskyBridge.db
        .selectFrom('note')
        .innerJoin('player', 'player.did', 'note.player_did')
        .select(['note.id', 'note.text', 'note.author', 'note.created_at'])
        .where('player.did', '=', request.query.player_did)
        .orderBy('note.created_at', 'desc')
        .execute();

      return reply.view('admin/fragments/player-notes.ejs', {
        ...dateUtils,
        notes,
      });
    }
  );

  app.post(
    '/player-notes',
    {
      schema: {
        body: z.object({
          player_did: z.string(),
          note_text: z.string(),
        }),
      },
    },
    async function (request, reply) {
      const author = reply.locals?.player as Player;
      const player = await this.blueskyBridge.playerService.getPlayer(
        request.body.player_did
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

      reply.header(
        'HX-Trigger',
        JSON.stringify({
          'ss-close-modal': true,
        })
      );
      return reply.code(204).send();
    }
  );
};
