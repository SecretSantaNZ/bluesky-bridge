import newrelic from 'newrelic';
import ms from 'ms';
import { RichText, type Agent } from '@atproto/api';
import type { Database } from './database/index.js';
import { loadSettings } from './settings.js';
import { getRandomMessage } from '../util/getRandomMessage.js';
import { TZDate } from '@date-fns/tz';
import { set, isAfter, isBefore } from 'date-fns';
import type { Settings } from './database/schema.js';

export class NudgeSender {
  private intervalId?: ReturnType<typeof setInterval>;
  private lastSettings?: Pick<Settings, 'nudge_rate' | 'send_messages'>;
  constructor(
    private readonly db: Database,
    private readonly robotAgent: () => Promise<Agent>
  ) {
    this.init();
  }

  private async init() {
    const settings = await this.db
      .selectFrom('settings')
      .select(['nudge_rate', 'send_messages'])
      .executeTakeFirstOrThrow();
    await this.settingsChanged(settings);
  }

  async settingsChanged(
    settings: Pick<Settings, 'nudge_rate' | 'send_messages'>
  ) {
    const nudgeRateChanged =
      this.lastSettings?.nudge_rate !== settings.nudge_rate;
    const shouldClear =
      this.intervalId != null && (!settings.send_messages || nudgeRateChanged);
    const shouldStart =
      settings.send_messages && (this.intervalId == null || nudgeRateChanged);

    if (shouldClear) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (shouldStart) {
      this.intervalId = setInterval(
        this.sendANudge.bind(this),
        ms(settings.nudge_rate as ms.StringValue)
      );
    }
  }

  async sendANudge() {
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
      console.log('skipping nudges, outside of time');
      return;
    }
    try {
      console.log('checking for nudges to send');
      const [nudge, settings] = await Promise.all([
        this.db
          .selectFrom('nudge')
          .innerJoin('match', 'match.id', 'nudge.match')
          .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
          .innerJoin('nudge_type', 'nudge_type.id', 'nudge.nudge_type')
          .innerJoin(
            'nudge_greeting',
            'nudge_greeting.id',
            'nudge.nudge_greeting'
          )
          .innerJoin('nudge_signoff', 'nudge_signoff.id', 'nudge.nudge_signoff')
          .select([
            'nudge.id as nudge_id',
            'giftee.handle as giftee_handle',
            'giftee.did as giftee_did',
            'nudge_type.name as nudge_type',
            'nudge_greeting.text as greeting',
            'nudge_signoff.text as signoff',
          ])
          .where('nudge.nudge_status', '=', 'queued')
          .orderBy('nudge.id asc')
          .limit(1)
          .executeTakeFirst(),
        loadSettings(this.db),
      ]);

      if (nudge == null) return;

      const nudgeType = nudge.nudge_type.toLowerCase();
      const [messageBody, hintIdea] = await Promise.all([
        getRandomMessage(this.db, 'nudge-' + nudgeType, {
          ...settings,
        }),
        getRandomMessage(this.db, 'hint-idea', {}),
      ]);

      let rawMessage = `${nudge.greeting} @${nudge.giftee_handle}. ${messageBody} ${nudge.signoff}`;
      if (nudgeType === 'hint') {
        const nudgeWithHint =
          rawMessage + `\n\nNot sure what to say? How about:\n${hintIdea}?\n\n`;
        if (nudgeWithHint.length <= 287) {
          rawMessage = nudgeWithHint;
        }
      }
      rawMessage += ` [Sent by 🤖]`;

      const message = new RichText({
        text: rawMessage,
      });

      const client = await this.robotAgent();
      await message.detectFacets(client);

      try {
        const result = await client.post({
          text: message.text,
          facets: message.facets,
        });

        const uriParts = result.uri.split('/');
        const repository = uriParts[2];
        const rkey = uriParts[4];
        const post_url = `https://bsky.app/profile/${repository}/post/${rkey}`;

        await this.db
          .updateTable('nudge')
          .set({ nudge_status: 'sent', post_url })
          .where('id', '=', nudge.nudge_id)
          .executeTakeFirstOrThrow();
        newrelic.recordCustomEvent('SecretSantaNudgeSent', {
          recipientDid: nudge.giftee_did,
          recipientHandle: nudge.giftee_handle,
          nudgeType: nudge.nudge_type,
          recordId: nudge.nudge_id,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        const errorText = String('message' in e ? e.message : e);
        await this.db
          .updateTable('nudge')
          .set({ nudge_status: `error: ${errorText}` })
          .where('id', '=', nudge.nudge_id)
          .executeTakeFirstOrThrow();
        console.error('Unable to send nudge', e);
        newrelic.noticeError(e, {
          recipientDid: nudge.giftee_did,
          recipientHandle: nudge.giftee_handle,
          nudgeType: nudge.nudge_type,
          recordId: nudge.nudge_id,
        });
      }
    } catch (e) {
      console.error('Unable to prepare nudge', e);
    }
  }
}
