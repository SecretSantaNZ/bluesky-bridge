import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import { baseAdminPlayerQuery } from '../manage-players.js';
import { notes } from './notes.js';
import { badges } from './badges.js';
import { address } from './address.js';
import { gameMode } from './game-mode.js';
import type { InsertObject } from 'kysely';
import type { DatabaseSchema } from '../../../../lib/database/schema.js';
import {
  getBridgedHandle,
  resolveMastodonHandle,
} from '../../../mastodon/index.js';
import { getLocation } from '../../../../lib/googlePlaces.js';

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  await app.register(notes, { prefix: '/:player_id' });
  await app.register(badges, { prefix: '/:player_id' });
  await app.register(address, { prefix: '/:player_id' });
  await app.register(gameMode, { prefix: '/:player_id' });

  app.post(
    '/',
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

      const adminPlayer = await baseAdminPlayerQuery(db)
        .where('did', '=', playerDid)
        .executeTakeFirst();
      return reply.nunjucks('common/server-events', {
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );

  app.post(
    '/:player_id/refresh-following',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { db, playerService } = app.blueskyBridge;
      const player = await playerService.refreshFollowing(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }

      const adminPlayer = await baseAdminPlayerQuery(db)
        .where('player.id', '=', request.params.player_id)
        .executeTakeFirstOrThrow();

      return reply.nunjucks('common/server-events', {
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );

  app.post(
    '/:player_id/retry-dm',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { db, playerService } = app.blueskyBridge;
      const player = await playerService.refreshFollowing(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }

      await playerService.retryPlayerDms(player.did);

      const adminPlayer = await baseAdminPlayerQuery(db)
        .where('player.id', '=', request.params.player_id)
        .executeTakeFirstOrThrow();

      return reply.nunjucks('common/server-events', {
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );

  app.post(
    '/:player_id/boot',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({
          opt_out: z.string().optional(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db, playerService } = app.blueskyBridge;
      const player = await playerService.refreshFollowing(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }

      if (request.body.opt_out) {
        await playerService.optOut(player.did);
      } else {
        await playerService.patchPlayer(player.did, {
          booted: new Date().toISOString(),
          booted_by: request.tokenSubject,
        });
      }

      const adminPlayer = await baseAdminPlayerQuery(db)
        .where('player.id', '=', request.params.player_id)
        .executeTakeFirstOrThrow();

      return reply.nunjucks('common/server-events', {
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );

  app.post(
    '/:player_id/restore',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { db, playerService } = app.blueskyBridge;
      const player = await playerService.refreshFollowing(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }

      await playerService.patchPlayer(player.did, {
        booted: null,
        booted_by: null,
        opted_out: false,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      const adminPlayer = await baseAdminPlayerQuery(db)
        .where('player.id', '=', request.params.player_id)
        .executeTakeFirstOrThrow();

      return reply.nunjucks('common/server-events', {
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );
};
