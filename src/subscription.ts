import {
  Jetstream,
  type CommitCreateEvent,
  type CommitDeleteEvent,
  type CommitUpdateEvent,
  type IdentityEvent,
  type JetstreamOptions,
} from '@skyware/jetstream';

import WebSocket from 'ws';

import type { Database } from './lib/database/index.js';
import type { PlayerService } from './lib/PlayerService.js';

export class FirehoseSubscription {
  private jetstream: Jetstream | undefined;
  constructor(
    private readonly db: Database,
    private readonly playerService: PlayerService,
    private readonly santaAccountDid: string
  ) {}

  private async getJetstreamOptions(): Promise<
    Pick<JetstreamOptions, 'wantedCollections' | 'wantedDids'>
  > {
    const players = await this.db
      .selectFrom('player')
      .select(['did'])
      .execute();
    const dids = new Set(
      players
        .map((player) => player.did)
        // Hack, I have a lot of invalid test dids so filter those out
        .filter(
          (did) => did.startsWith('did:web:') || did.startsWith('did:plc:')
        )
    );
    dids.add(this.santaAccountDid);

    return {
      wantedCollections: ['app.bsky.graph.follow', 'app.bsky.actor.profile'],
      wantedDids: Array.from(dids),
    };
  }

  async start() {
    const options = await this.getJetstreamOptions();
    this.jetstream = new Jetstream({
      ...options,
      ws: WebSocket,
      endpoint: 'wss://jetstream2.us-west.bsky.network/subscribe',
      // TODO cursor
      // TODO handle error
    });
    this.jetstream.start();

    this.jetstream.on('identity', this.onIdentity.bind(this));
    this.jetstream.onCreate(
      'app.bsky.graph.follow',
      this.onFollowCreate.bind(this)
    );
    this.jetstream.onDelete(
      'app.bsky.graph.follow',
      this.onFollowDelete.bind(this)
    );
    this.jetstream.onUpdate(
      'app.bsky.actor.profile',
      this.onProfileUpdate.bind(this)
    );
    this.jetstream.onCreate(
      'app.bsky.actor.profile',
      this.onProfileUpdate.bind(this)
    );
  }

  async playersChanged() {
    const jetstream = this.jetstream;
    if (jetstream == null) return;

    jetstream.updateOptions(await this.getJetstreamOptions());
  }

  async onIdentity(event: IdentityEvent) {
    await this.playerService.updateHandle(
      event.did,
      event.identity.handle ?? event.did
    );
  }

  async onFollowCreate(event: CommitCreateEvent<'app.bsky.graph.follow'>) {
    const followUri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`;
    this.playerService.recordFollow(
      event.did,
      event.commit.record.subject,
      followUri
    );
  }

  async onFollowDelete(event: CommitDeleteEvent<'app.bsky.graph.follow'>) {
    const followUri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`;
    await this.playerService.removeFollow(followUri);
  }

  async onProfileUpdate(
    event:
      | CommitCreateEvent<'app.bsky.actor.profile'>
      | CommitUpdateEvent<'app.bsky.actor.profile'>
  ) {
    let avatar_url: string = '';
    if (event.commit.record.avatar != null) {
      avatar_url = `https://cdn.bsky.app/img/avatar/plain/${event.did}/${event.commit.record.avatar.ref.$link}@jpeg`;
    }
    await this.playerService.patchPlayer(event.did, { avatar_url });
  }
}
