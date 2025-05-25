import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, ForbiddenError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getBridgedHandle, resolveMastodonHandle } from '../mastodon/index.js';
import type { InsertObject } from 'kysely';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import { escapeUnicode } from '../../util/escapeUnicode.js';
import { getLocation } from '../../lib/googlePlaces.js';

export const newPlayer: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/new-player',
    {
      schema: {
        body: z.object({
          player_type: z.enum(['bluesky', 'mastodon']),
          handle: z.string(),
          address: z.string(),
          delivery_instructions: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      if (!request.tokenData?.admin) {
        throw new ForbiddenError();
      }
      const { playerService, db, santaAgent } = app.blueskyBridge;
      let handle = request.body.handle.replace(/^@/, '').trim();
      let additionalAttributes: Partial<
        InsertObject<DatabaseSchema, 'player'>
      > = {};
      if (request.body.player_type === 'mastodon') {
        const [, instance] = handle.split('@');
        const { handle: mastodon_account, host } = await resolveMastodonHandle(
          handle,
          instance as string
        );
        handle = getBridgedHandle(mastodon_account);
        const following =
          await playerService.lookupMastodonFollowing(mastodon_account);
        additionalAttributes = {
          mastodon_account,
          mastodon_host: host,
          ...following,
        };
      } else if (handle.endsWith('.ap.brid.gy')) {
        throw new BadRequestError('Mastodon handle');
      } else {
        handle = handle.replace(/@/g, '.');
      }
      const agent = await santaAgent();
      const resolveHandleResult = await agent.resolveHandle({
        handle,
      });
      const playerDid = resolveHandleResult.data.did;
      const location = request.body.address
        ? await getLocation(handle, request.body.address)
        : null;
      await playerService.createPlayer(playerDid, request.body.player_type, {
        ...additionalAttributes,
        address: request.body.address || null,
        address_location: location ? JSON.stringify(location) : null,
        delivery_instructions: request.body.delivery_instructions || null,
      });
      // Don't integrate this into the above create because the signup complete
      // trigger only fires on an update
      await playerService.patchPlayer(playerDid, {
        game_mode: 'Regular',
        max_giftees: 1,
      });

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', playerDid)
        .executeTakeFirst();
      reply.header(
        'HX-Trigger',
        escapeUnicode(
          JSON.stringify({
            'ss-player-added': updatedPlayer,
            'ss-close-modal': true,
          })
        )
      );
      return reply.code(204).send();
    }
  );
};
