import { randomUUID } from 'crypto';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export const mastodon: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get('/', async function (request, reply) {
    const { db } = rawApp.blueskyBridge;

    const settings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();

    return reply.view(
      'mastodon/login-card.ejs',
      {
        player: null,
        settings,
        replaceUrl: '/mastodon',
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
