import { describe, expect, it } from 'vitest';
import type { Player } from '../../lib/PlayerService.js';
import { assemblePlayerBadges, forcedViewForPlayer } from './player-home.js';

const player = (overrides: Partial<PlayerOverrides> = {}): Partial<Player> =>
  ({
    admin: 0,
    address: '12 Queen St',
    game_mode: 'Regular',
    booted: null,
    opted_out: null,
    ...overrides,
  }) as unknown as Partial<Player>;

type PlayerOverrides = {
  booted: string | null;
  opted_out: string | null;
  admin: number;
  address: string | null;
  game_mode: 'Regular' | 'Super Santa' | 'Santa Only' | 'Giftee Only' | null;
};

describe('forcedViewForPlayer', () => {
  it('does not force a view once the profile is complete', () => {
    expect(forcedViewForPlayer(player() as Player, 'GET')).toBeNull();
  });

  it('ignores non-GET requests', () => {
    expect(forcedViewForPlayer(player() as Player, 'POST')).toBeNull();
  });

  it('locks booted players out, clearing non-admin sessions', () => {
    const booted = forcedViewForPlayer(
      player({ booted: '2025-12-01' }) as Player,
      'GET'
    );
    expect(booted).toEqual({ view: 'player/booted-out', clearSession: true });
    const adminBooted = forcedViewForPlayer(
      player({ booted: '2025-12-01', admin: 1 }) as Player,
      'GET'
    );
    expect(adminBooted).toEqual({
      view: 'player/booted-out',
      clearSession: false,
    });
  });

  it('shows opted out players their opted out view', () => {
    expect(
      forcedViewForPlayer(player({ opted_out: '2025-12-01' }) as Player, 'GET')
    ).toEqual({ view: 'player/opted-out', clearSession: false });
  });

  it('sends players without an address to the address form', () => {
    expect(
      forcedViewForPlayer(player({ address: null }) as Player, 'GET')
    ).toEqual({ view: 'player/address', clearSession: false });
    expect(
      forcedViewForPlayer(player({ address: '   ' }) as Player, 'GET')
    ).toEqual({ view: 'player/address', clearSession: false });
  });

  it('lets santa only players skip the address', () => {
    expect(
      forcedViewForPlayer(
        player({ address: null, game_mode: 'Santa Only' }) as Player,
        'GET'
      )
    ).toBeNull();
  });

  it('asks players without a game mode to pick one', () => {
    expect(
      forcedViewForPlayer(player({ game_mode: null }) as Player, 'GET')
    ).toEqual({ view: 'player/game-mode', clearSession: false });
  });

  it('treats a no-game-mode santa-only player like a missing game mode', () => {
    // The address gate comes first for undecided players: address wins over
    // game mode selection, matching the original hook behavior.
    expect(
      forcedViewForPlayer(
        player({ address: null, game_mode: null }) as Player,
        'GET'
      )
    ).toEqual({ view: 'player/address', clearSession: false });
  });
});

describe('assemblePlayerBadges', () => {
  const settings = { current_game_badge_id: 3 };

  it('includes the sent-present badge only once a gift has been sent', () => {
    const sentBadge = { id: 1, image_url: 'sent.png' };
    expect(
      assemblePlayerBadges(
        sentBadge,
        0,
        [{ id: 5, image_url: 'x.png' }],
        settings
      )
    ).toEqual([{ id: 5, image_url: 'x.png' }]);
    expect(
      assemblePlayerBadges(
        sentBadge,
        1,
        [{ id: 5, image_url: 'x.png' }],
        settings
      )
    ).toEqual([sentBadge, { id: 5, image_url: 'x.png' }]);
  });

  it('hides the current game badge and badges without images', () => {
    expect(
      assemblePlayerBadges(
        null,
        0,
        [
          { id: 3, image_url: 'current.png' },
          { id: 4, image_url: null },
          { id: 5, image_url: 'x.png' },
        ],
        settings
      )
    ).toEqual([{ id: 5, image_url: 'x.png' }]);
  });
});
