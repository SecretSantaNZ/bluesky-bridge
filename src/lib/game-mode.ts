import { BadRequestError } from 'http-errors-enhanced';
import type { Player } from './PlayerService.js';

/** Applies game-mode giftee limit rules:
 *  - Super Santa requires opting in to at least 2 giftees.
 *  - Regular always matches a single giftee.
 *  - Giftee Only never matches any giftees. */
export function resolveMaxGiftees(
  game_mode: NonNullable<Player['game_mode']>,
  max_giftees: number
): number {
  if (game_mode === 'Super Santa' && (!max_giftees || max_giftees < 2)) {
    throw new BadRequestError(
      'Must opt in to at least 2 giftees if super santa'
    );
  }
  let defaultedMaxGiftees = max_giftees;
  if (game_mode === 'Regular') {
    defaultedMaxGiftees = 1;
  } else if (game_mode === 'Giftee Only') {
    defaultedMaxGiftees = 0;
  }
  return defaultedMaxGiftees;
}
