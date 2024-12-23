import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const updateAddress: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
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
};
