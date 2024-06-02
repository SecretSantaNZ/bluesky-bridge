import { InternalServerError } from 'http-errors-enhanced';
import type { Database } from '../lib/database/index.js';

export const getRandomMessage = async (
  db: Database,
  messageType: string,
  substitutions: Record<string, unknown>
) => {
  const messageTemplates = await db
    .selectFrom('message')
    .selectAll()
    .where('message_type', '=', messageType)
    .orderBy('id')
    .execute();

  const messageTemplate =
    messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
  if (messageTemplate == null) {
    throw new InternalServerError(`No messages for ${messageType}`);
  }

  let message = messageTemplate.message;
  for (const [key, value] of Object.entries(substitutions)) {
    message = message.replaceAll(`$${key}$`, String(value));
  }

  return message;
};
