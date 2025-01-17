import type { FastifyPluginAsync } from 'fastify';

export const publicContent: FastifyPluginAsync = async (app) => {
  app.addHook('preValidation', async function (request, reply) {
    const settings = await this.blueskyBridge.db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();

    reply.locals = {
      ...reply.locals,
      player: undefined,
      settings,
    };
  });

  app.get('/faq', async function (request, reply) {
    return reply.view(
      'public/faq.ejs',
      {
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
