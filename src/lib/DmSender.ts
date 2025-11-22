import newrelic from 'newrelic';
import ms from 'ms';
import { RichText, type Agent } from '@atproto/api';
import type { Database } from './database/index.js';
import { loadSettings, type Settings as TidySettings } from './settings.js';
import { getRandomMessage } from '../util/getRandomMessage.js';
import { tz, TZDate } from '@date-fns/tz';
import {
  set,
  isAfter,
  isBefore,
  addHours,
  subDays,
  parseISO,
  formatISO,
} from 'date-fns';
import type { Settings } from './database/schema.js';
import { formatDate } from '../lib/dates.js';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import wretch from 'wretch';
import FormDataAddon from 'wretch/addons/formData';

const w = wretch()
  .polyfills({
    fetch: safeFetchWrap(),
  })
  .addon(FormDataAddon)
  .options({
    redirect: 'error',
  });

export interface DM {
  dmType: string;
  playerType: 'bluesky' | 'mastodon';
  recipientDid: string;
  recipientHandle: string;
  recipientMastodonHandle: string | null;
  recordId: number;
  rawMessage: string;
  markSent: () => Promise<unknown>;
  markError: (errorText: string) => Promise<unknown>;
}

export type DMQueue = (
  db: Database,
  settings: TidySettings
) => Promise<DM | undefined>;

const signupComplete1DMQueue: DMQueue = async (db, settings) => {
  const player = await db
    .selectFrom('player')
    .select(['id', 'handle', 'did', 'player_type', 'mastodon_account'])
    .where('player.signup_complete', '=', 1)
    .where('player.next_player_dm', '=', 'signup-complete-1')
    .where('player.player_dm_status', '=', 'queued')
    .orderBy('player.id', 'asc')
    .executeTakeFirst();

  if (player == null) return undefined;

  const rawMessage = await getRandomMessage(db, 'dm-signup-complete-1', {
    hashtag: settings.hashtag,
    matches_sent_date: formatDate(settings.matches_sent_date),
    send_by_date: formatDate(settings.send_by_date),
    opening_date: formatDate(settings.opening_date),
    elf_list: settings.elf_list,
  });

  const markSent = async () =>
    db
      .updateTable('player')
      .set({
        next_player_dm: 'signup-complete-2',
        next_player_dm_after: addHours(new Date(), 18).toISOString(),
      })
      .where('id', '=', player.id)
      .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('player')
      .set({ player_dm_status: `error: ${errorText}` })
      .where('id', '=', player.id)
      .execute();

  return {
    dmType: 'signup-complete-1',
    recipientDid: player.did,
    recipientHandle: player.handle,
    playerType: player.player_type,
    recipientMastodonHandle: player.mastodon_account,
    recordId: player.id,
    rawMessage,
    markSent,
    markError,
  };
};

const signupComplete2DMQueue: DMQueue = async (db, settings) => {
  const player = await db
    .selectFrom('player')
    .select([
      'id',
      'handle',
      'did',
      'player_type',
      'mastodon_account',
      'game_mode',
    ])
    .where('player.signup_complete', '=', 1)
    .where('player.next_player_dm', '=', 'signup-complete-2')
    .where('player.next_player_dm_after', '<=', new Date().toISOString())
    .where('player.player_dm_status', '=', 'queued')
    .orderBy('player.id', 'asc')
    .executeTakeFirst();

  if (player == null) return undefined;

  const rawMessage = await getRandomMessage(db, 'dm-signup-complete-2', {
    hashtag: settings.hashtag,
    elf_list: settings.elf_list,
  });

  const markSent =
    player.game_mode === 'Santa Only'
      ? // Santa only players don't get an address dm because they don't need an address
        () => markSignupComplete3DMSent(db, settings, player.id)
      : async () =>
          db
            .updateTable('player')
            .set({
              next_player_dm: 'signup-complete-3',
              next_player_dm_after: addHours(new Date(), 18).toISOString(),
            })
            .where('id', '=', player.id)
            .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('player')
      .set({ player_dm_status: `error: ${errorText}` })
      .where('id', '=', player.id)
      .execute();

  return {
    dmType: 'signup-complete-2',
    recipientDid: player.did,
    recipientHandle: player.handle,
    playerType: player.player_type,
    recipientMastodonHandle: player.mastodon_account,
    recordId: player.id,
    rawMessage,
    markSent,
    markError,
  };
};

const markSignupComplete3DMSent = async (
  db: Database,
  settings: TidySettings,
  player_id: number
) => {
  const intervalDate = addHours(new Date(), 18);
  const beforeMatchDay = subDays(
    parseISO(settings.matches_sent_date + 'T00:00:00.000', {
      in: tz('Pacific/Auckland'),
    }),
    1
  );
  const nextDmDate = isAfter(intervalDate, beforeMatchDay)
    ? intervalDate
    : beforeMatchDay;
  await db
    .updateTable('player')
    .set({
      next_player_dm: 'signup-complete-4',
      next_player_dm_after: formatISO(nextDmDate, { in: tz('UTC') }),
    })
    .where('id', '=', player_id)
    .execute();
};

const signupComplete3DMQueue: DMQueue = async (db, settings) => {
  const player = await db
    .selectFrom('player')
    .select([
      'id',
      'handle',
      'did',
      'player_type',
      'mastodon_account',
      'delivery_instructions',
      'address',
    ])
    .where('player.signup_complete', '=', 1)
    .where('player.next_player_dm', '=', 'signup-complete-3')
    .where('player.next_player_dm_after', '<=', new Date().toISOString())
    .where('player.player_dm_status', '=', 'queued')
    .orderBy('player.id', 'asc')
    .executeTakeFirst();

  if (player == null) return undefined;

  const rawMessage = await getRandomMessage(db, 'dm-signup-complete-3', {
    giftee_instructions: player.delivery_instructions
      ? player.delivery_instructions + '\n\n'
      : '',
    giftee_address: player.address,
    elf_list: settings.elf_list,
  });

  const markSent = () => markSignupComplete3DMSent(db, settings, player.id);

  const markError = async (errorText: string) =>
    db
      .updateTable('player')
      .set({ player_dm_status: `error: ${errorText}` })
      .where('id', '=', player.id)
      .execute();

  return {
    dmType: 'signup-complete-3',
    recipientDid: player.did,
    recipientHandle: player.handle,
    playerType: player.player_type,
    recipientMastodonHandle: player.mastodon_account,
    recordId: player.id,
    rawMessage,
    markSent,
    markError,
  };
};

const signupComplete4DMQueue: DMQueue = async (db, settings) => {
  const player = await db
    .selectFrom('player')
    .select([
      'id',
      'handle',
      'did',
      'player_type',
      'mastodon_account',
      'delivery_instructions',
      'address',
    ])
    .where('player.signup_complete', '=', 1)
    .where('player.next_player_dm', '=', 'signup-complete-4')
    .where('player.next_player_dm_after', '<=', new Date().toISOString())
    .where('player.player_dm_status', '=', 'queued')
    .orderBy('player.id', 'asc')
    .executeTakeFirst();

  if (player == null) return undefined;

  const rawMessage = await getRandomMessage(db, 'dm-signup-complete-4', {
    hashtag: settings.hashtag,
    elf_list: settings.elf_list,
  });

  const markSent = async () =>
    db
      .updateTable('player')
      .set({
        next_player_dm: null,
        next_player_dm_after: addHours(new Date(), 18).toISOString(),
        player_dm_status: 'sent',
      })
      .where('id', '=', player.id)
      .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('player')
      .set({ player_dm_status: `error: ${errorText}` })
      .where('id', '=', player.id)
      .execute();

  return {
    dmType: 'signup-complete-4',
    recipientDid: player.did,
    recipientHandle: player.handle,
    playerType: player.player_type,
    recipientMastodonHandle: player.mastodon_account,
    recordId: player.id,
    rawMessage,
    markSent,
    markError,
  };
};

const matchHandleDMQueue: DMQueue = async (db, settings) => {
  const match = await db
    .selectFrom('match')
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .select([
      'giftee.handle as giftee_handle',
      'santa.did as santa_did',
      'santa.handle as santa_handle',
      'santa.player_type as santa_player_type',
      'santa.mastodon_account as santa_mastodon_account',
      'match.id as match_id',
    ])
    .where('match.deactivated', 'is', null)
    .where('match.match_status', '=', 'shared')
    .where('match.dm_handle_status', '=', 'queued')
    .where('santa.following_santa_uri', 'is not', null)
    .orderBy('match.id', 'asc')
    .executeTakeFirst();

  if (match == null) return undefined;

  const rawMessage = await getRandomMessage(db, 'dm-match-handle', {
    ...match,
    ...settings,
    giftee_handle: '@' + match.giftee_handle,
  });

  const markSent = async () =>
    db
      .updateTable('match')
      .set({ dm_handle_status: 'sent' })
      .where('id', '=', match.match_id)
      .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('match')
      .set({ dm_handle_status: `error: ${errorText}` })
      .where('id', '=', match.match_id)
      .execute();

  return {
    dmType: 'match-handle',
    recipientDid: match.santa_did,
    recipientHandle: match.santa_handle,
    playerType: match.santa_player_type,
    recipientMastodonHandle: match.santa_mastodon_account,
    recordId: match.match_id,
    rawMessage,
    markSent,
    markError,
  };
};

const matchAddressDMQueue: DMQueue = async (db, settings) => {
  const match = await db
    .selectFrom('match')
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .select([
      'giftee.handle as giftee_handle',
      'giftee.delivery_instructions as giftee_instructions',
      'giftee.address as giftee_address',
      'santa.did as santa_did',
      'santa.handle as santa_handle',
      'santa.player_type as santa_player_type',
      'santa.mastodon_account as santa_mastodon_account',
      'match.id as match_id',
    ])
    .where('match.deactivated', 'is', null)
    .where('match.match_status', '=', 'locked')
    .where('match.dm_address_status', '=', 'queued')
    .where('santa.following_santa_uri', 'is not', null)
    .orderBy('match.id', 'asc')
    .executeTakeFirst();

  if (match == null) return undefined;

  const rawMessage = await getRandomMessage(db, 'dm-match-address', {
    ...match,
    ...settings,
    giftee_handle: '@' + match.giftee_handle,
    giftee_instructions: match.giftee_instructions
      ? match.giftee_instructions + '\n\n'
      : '',
  });

  const markSent = async () =>
    db
      .updateTable('match')
      .set({ dm_address_status: 'sent' })
      .where('id', '=', match.match_id)
      .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('match')
      .set({ dm_address_status: `error: ${errorText}` })
      .where('id', '=', match.match_id)
      .execute();

  return {
    dmType: 'match-address',
    recipientDid: match.santa_did,
    recipientHandle: match.santa_handle,
    playerType: match.santa_player_type,
    recipientMastodonHandle: match.santa_mastodon_account,
    recordId: match.match_id,
    rawMessage,
    markSent,
    markError,
  };
};

const trackingDMQueue: DMQueue = async (db, settings) => {
  const tracking = await db
    .selectFrom('tracking')
    .innerJoin('match', 'match.id', 'tracking.match')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .innerJoin('carrier', 'carrier.id', 'tracking.carrier')
    .select([
      'tracking.shipped_date as date_shipped',
      'carrier.text as carrier',
      'tracking.tracking_number as tracking_number',
      'tracking.giftwrap_status as giftwrap_status',
      'giftee.did as giftee_did',
      'giftee.handle as giftee_handle',
      'giftee.player_type as giftee_player_type',
      'giftee.mastodon_account as giftee_mastodon_account',
      'tracking.id as tracking_id',
    ])
    .where('tracking.deactivated', 'is', null)
    .where('tracking.tracking_status', '=', 'queued')
    .where('giftee.following_santa_uri', 'is not', null)
    .orderBy('match.id', 'asc')
    .executeTakeFirst();

  if (tracking == null) return undefined;

  const preMessage = await getRandomMessage(db, 'dm-tracking-added', {
    ...tracking,
    ...settings,
    date_shipped: formatDate(tracking.date_shipped),
  });
  const rawMessage =
    preMessage +
    (tracking.giftwrap_status
      ? ' The gifts inside the postal packaging are wrapped, it is safe to remove the outer layer! Opening Day is '
      : ' The present is not gift-wrapped. Please do not remove the postal packaging until Opening Day on ') +
    formatDate(settings.opening_date) +
    '.';

  const markSent = async () =>
    db
      .updateTable('tracking')
      .set({ tracking_status: 'sent' })
      .where('id', '=', tracking.tracking_id)
      .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('tracking')
      .set({ tracking_status: `error: ${errorText}` })
      .where('id', '=', tracking.tracking_id)
      .execute();

  return {
    dmType: 'tracking',
    recipientDid: tracking.giftee_did,
    recipientHandle: tracking.giftee_handle,
    playerType: tracking.giftee_player_type,
    recipientMastodonHandle: tracking.giftee_mastodon_account,
    recordId: tracking.tracking_id,
    rawMessage,
    markSent,
    markError,
  };
};

const pokeInactiveDMQueue: DMQueue = async (db, settings) => {
  const player = await db
    .selectFrom('player')
    .select(['id', 'handle', 'did', 'player_type', 'mastodon_account'])
    .where('player.following_santa_uri', 'is not', null)
    .where('player.next_player_dm', '=', 'poke-inactive')
    .where('player.next_player_dm_after', '<=', new Date().toISOString())
    .where('player.player_dm_status', '=', 'queued')
    .orderBy('player.id', 'asc')
    .executeTakeFirst();

  if (player == null) return undefined;

  const rawMessage = `Opening day is fast approaching, it looks like you haven't quite sent your ${settings.hashtag} present.\n\nIt would really help me out if you either:\n\n1. Enter the details in the app (https://secretsanta.nz) if you've already sent/delivered it, even if you don't have a tracking number.\n2. Send your giftee a Present Update nudge if you're running a bit late, so they know not to worry.\n3. Get in touch with me or one of the Elves if you need a hand or life has, as it does, got in the way.\n\nRemember, ${settings.elf_list} and me (@secretsanta.nz) are here to help make this a magical Hogswatch for everyone!`;

  const markSent = async () =>
    db
      .updateTable('player')
      .set({
        next_player_dm: null,
        next_player_dm_after: addHours(new Date(), 18).toISOString(),
        player_dm_status: 'sent',
      })
      .where('id', '=', player.id)
      .execute();

  const markError = async (errorText: string) =>
    db
      .updateTable('player')
      .set({ player_dm_status: `error: ${errorText}` })
      .where('id', '=', player.id)
      .execute();

  return {
    dmType: 'poke-inactive',
    recipientDid: player.did,
    recipientHandle: player.handle,
    playerType: player.player_type,
    recipientMastodonHandle: player.mastodon_account,
    recordId: player.id,
    rawMessage,
    markSent,
    markError,
  };
};

const dmQueues = [
  signupComplete1DMQueue,
  signupComplete2DMQueue,
  signupComplete3DMQueue,
  signupComplete4DMQueue,
  matchHandleDMQueue,
  matchAddressDMQueue,
  trackingDMQueue,
  pokeInactiveDMQueue,
];

export class DmSender {
  private intervalId?: ReturnType<typeof setInterval>;
  private lastSettings?: Pick<Settings, 'dm_rate' | 'send_messages'>;
  private nextDmQueue = 0;

  constructor(
    private readonly db: Database,
    private readonly santaAgent: () => Promise<Agent>,
    public readonly santaMastodonHandle: string,
    public readonly santaMastodonHost: string
  ) {
    this.init();
  }

  private async init() {
    const settings = await this.db
      .selectFrom('settings')
      .select(['dm_rate', 'send_messages'])
      .executeTakeFirstOrThrow();
    await this.settingsChanged(settings);
  }

  async settingsChanged(settings: Pick<Settings, 'dm_rate' | 'send_messages'>) {
    const dmRateChanged = this.lastSettings?.dm_rate !== settings.dm_rate;
    const shouldClear =
      this.intervalId != null && (!settings.send_messages || dmRateChanged);
    const shouldStart =
      settings.send_messages && (this.intervalId == null || dmRateChanged);

    if (shouldClear) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (shouldStart) {
      this.intervalId = setInterval(
        this.sendADm.bind(this),
        ms(settings.dm_rate as ms.StringValue)
      );
    }
  }

  async sendDm(dm: DM) {
    const client = await this.santaAgent();
    const sendFromDid = client.sessionManager.did as string;
    if (sendFromDid === dm.recipientDid) {
      await dm.markSent();
      return;
    }

    const text = dm.rawMessage + '\n\n[Sent by 🤖]';
    const bskyMessage = new RichText({
      text,
    });
    await bskyMessage.detectFacets(client);
    const mastodonMessage = `@${dm.recipientMastodonHandle} ${text}`;

    try {
      if (dm.playerType === 'bluesky') {
        const {
          data: { convo },
        } = await client.api.chat.bsky.convo.getConvoForMembers(
          {
            members: [sendFromDid, dm.recipientDid],
          },
          {
            headers: {
              'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            },
          }
        );
        await client.api.chat.bsky.convo.sendMessage(
          {
            convoId: convo.id,
            message: {
              text: bskyMessage.text,
              facets: bskyMessage.facets,
            },
          },
          {
            encoding: 'application/json',
            headers: {
              'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            },
          }
        );
      } else {
        const santaToken = await this.db
          .selectFrom('mastodon_token')
          .selectAll()
          .where('account', '=', this.santaMastodonHandle)
          .executeTakeFirstOrThrow();

        await w
          .headers({
            Authorization: `Bearer ${santaToken.token}`,
          })
          .post(
            {
              status: mastodonMessage,
              language: 'en',
              visibility: 'direct',
            },
            new URL('/api/v1/statuses', `https://${this.santaMastodonHost}`)
              .href
          )
          .json();
      }
      await dm.markSent();
      newrelic.recordCustomEvent('SecretSantaDMSent', {
        recipientDid: dm.recipientDid,
        recipientHandle: dm.recipientHandle,
        playerType: dm.playerType,
        recipientMastodonHandle: dm.recipientMastodonHandle ?? '',
        dmType: dm.dmType,
        recordId: dm.recordId,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const errorText = String('message' in e ? e.message : e);
      await dm.markError(errorText);
      console.error('Unable to send dm', e);
      newrelic.noticeError(e, {
        recipientDid: dm.recipientDid,
        recipientHandle: dm.recipientHandle,
        playerType: dm.playerType,
        recipientMastodonHandle: dm.recipientMastodonHandle ?? '',
        dmType: dm.dmType,
        recordId: dm.recordId,
      });
    }
  }

  async sendADm() {
    const now = new TZDate(new Date(), 'Pacific/Auckland');
    const earliest = set(now, {
      hours: 9,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
    const latest = set(earliest, {
      hours: 20,
    });
    if (!(isAfter(now, earliest) && isBefore(now, latest))) {
      console.log('skipping dm, outside of time');
      return;
    }
    console.log('checking for dm to send');
    const settings = await loadSettings(this.db);
    const startDmQueue = this.nextDmQueue;
    let dm: DM | undefined = undefined;
    do {
      dm = await dmQueues[this.nextDmQueue]?.(this.db, settings);
      this.nextDmQueue = (this.nextDmQueue + 1) % dmQueues.length;
    } while (dm == null && this.nextDmQueue !== startDmQueue);

    if (dm == null) return;

    try {
      await this.sendDm(dm);
    } catch (e) {
      console.error('Unable to prepare dm', e);
    }
  }
}
