import type { FastifyPluginAsync } from 'fastify';

export const nudges: FastifyPluginAsync = async (app) => {
  app.get('/nudges', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [nudges] = await Promise.all([
      db
        .selectFrom('nudge')
        .innerJoin('match', 'match.id', 'nudge.match')
        .innerJoin('player as santa', 'santa.id', 'match.santa')
        .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
        .innerJoin('nudge_type', 'nudge_type.id', 'nudge.nudge_type')
        .select([
          'santa.did as santa_did',
          'santa.handle as santa_handle',
          'santa.avatar_url as santa_avatar_url',
          'santa.note_count as santa_note_count',
          'giftee.did as giftee_did',
          'giftee.handle as giftee_handle',
          'giftee.avatar_url as giftee_avatar_url',
          'giftee.note_count as giftee_note_count',
          'nudge_type.name as nudge_type',
          'nudge.id as nudge_id',
          'nudge.created_at',
          'nudge_status',
        ])
        .orderBy('nudge.id', 'desc')
        .execute(),
    ]);
    const pageData = {
      nudges,
    };
    return reply.view(
      'admin/nudges.ejs',
      {
        pageData,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
