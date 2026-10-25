import { describe, expect, it } from 'vitest';
import {
  assignedByHashtagFor,
  buildBadgeSettingsUpdate,
  deriveAssignedForType,
} from './badges.js';

const settings = {
  current_game_badge_id: 1,
  sent_present_badge_id: 2,
  super_santa_badge_id: 3,
};

describe('deriveAssignedForType', () => {
  it('recognizes badges assigned by game role settings', () => {
    expect(
      deriveAssignedForType(settings, {
        id: 1,
        assigned_by_hashtag: null,
        assigned_by_elf: 0,
      })
    ).toBe('current_game');
    expect(
      deriveAssignedForType(settings, {
        id: 2,
        assigned_by_hashtag: null,
        assigned_by_elf: 0,
      })
    ).toBe('sent_present');
    expect(
      deriveAssignedForType(settings, {
        id: 3,
        assigned_by_hashtag: null,
        assigned_by_elf: 0,
      })
    ).toBe('super_santa');
  });

  it('falls back to the hashtag configuration', () => {
    expect(
      deriveAssignedForType(settings, {
        id: 9,
        assigned_by_hashtag: '#nzss',
        assigned_by_elf: 0,
      })
    ).toBe('posting');
    expect(
      deriveAssignedForType(settings, {
        id: 9,
        assigned_by_hashtag: '#nzss',
        assigned_by_elf: 1,
      })
    ).toBe('by_elf');
  });

  it('returns nothing for unassigned badges', () => {
    expect(
      deriveAssignedForType(settings, {
        id: 9,
        assigned_by_hashtag: null,
        assigned_by_elf: 0,
      })
    ).toBe('nothing');
  });
});

describe('buildBadgeSettingsUpdate', () => {
  it('moves a badge to a new role, clearing its previous role', () => {
    const update = buildBadgeSettingsUpdate(settings, 1, 'sent_present');
    expect(update).toEqual({
      current_game_badge_id: null,
      sent_present_badge_id: 1,
    });
  });

  it('clears all roles when reassigned to posting', () => {
    const update = buildBadgeSettingsUpdate(settings, 3, 'posting');
    expect(update).toEqual({ super_santa_badge_id: null });
  });

  it('assigns an unassigned badge to a role', () => {
    const update = buildBadgeSettingsUpdate(
      {
        current_game_badge_id: null,
        sent_present_badge_id: null,
        super_santa_badge_id: null,
      },
      7,
      'current_game'
    );
    expect(update).toEqual({ current_game_badge_id: 7 });
  });
});

describe('assignedByHashtagFor', () => {
  it('keeps the hashtag for hashtag-assignment types', () => {
    expect(assignedByHashtagFor('by_elf', '#nzss')).toBe('#nzss');
    expect(assignedByHashtagFor('posting', '#nzss')).toBe('#nzss');
    expect(assignedByHashtagFor('by_elf', undefined)).toBeNull();
  });

  it('clears the hashtag for other assignment types', () => {
    expect(assignedByHashtagFor('current_game', '#nzss')).toBeNull();
  });
});
