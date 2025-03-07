import type { Database } from './index.js';

export function queryTracking(db: Database) {
  return db
    .selectFrom('tracking')
    .innerJoin('carrier', 'carrier.id', 'tracking.carrier')
    .select([
      'tracking.id as tracking_id',
      'tracking.shipped_date',
      'tracking.tracking_number',
      'tracking.tracking_status',
      'carrier.text as carrier',
      'tracking.giftwrap_status',
      'tracking.missing',
    ])
    .where('tracking.deactivated', 'is', null);
}

export function queryTrackingWithMatch(db: Database) {
  return queryTracking(db).innerJoin('match', 'match.id', 'tracking.match');
}

export function queryTrackingWithGiftee(db: Database) {
  return queryTrackingWithMatch(db)
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .select([
      'giftee.handle as giftee_handle',
      'giftee.avatar_url as giftee_avatar_url',
    ]);
}

export function queryTrackingWithGifteeAndSanta(db: Database) {
  return queryTrackingWithGiftee(db)
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .select([
      'santa.handle as santa_handle',
      'santa.avatar_url as santa_avatar_url',
    ]);
}
