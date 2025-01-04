import type { FastifyPluginAsync } from 'fastify';

export const missingPresents: FastifyPluginAsync = async (app) => {
  app.get('/missing-presents', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [matches] = await Promise.all([
      db
        .selectFrom('match')
        .innerJoin('player as santa', 'santa.id', 'match.santa')
        .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
        .select([
          'santa.handle as santa_handle',
          'santa.deactivated as santa_deactivated',
          'santa.booted as santa_booted',
          'giftee.handle as giftee_handle',
          'giftee.deactivated as giftee_deactivated',
          'giftee.booted as giftee_booted',
          'match.invalid_player as invalid_player',
          'match.id as match_id',
          'match.nudge_present_update_count',
          'match.contacted',
          'match.tracking_count',
          'match.tracking_missing_count',
          'match.followup_action',
        ])
        .where('match.match_status', '=', 'locked')
        .where('match.deactivated', 'is', null)
        .where((eb) =>
          eb.or([
            eb('match.tracking_count', '=', 0),
            eb('match.tracking_missing_count', '>', 0),
          ])
        )
        .orderBy('match.id asc')
        .execute(),
    ]);
    const pageData = {
      matches,
    };
    return reply.view(
      'admin/missing-presents.ejs',
      {
        pageData,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
