import { DidResolver, MemoryCache } from '@atproto/identity';
import type { Agent } from '@atproto/api';
import type { NodeOAuthClient } from '@atproto/oauth-client-node';
import type { FastifyInstance } from 'fastify';
import ms from 'ms';

import { buildAtpClient, resolveHandle } from './bluesky.js';
import type { Database } from './lib/database/index.js';
import { DmSender } from './lib/DmSender.js';
import { initAtLoginClient } from './lib/initAtLoginClient.js';
import { NudgeSender } from './lib/NudgeSender.js';
import { PlayerService, type BridgedLookups } from './lib/PlayerService.js';
import { resolveMastodonHandle } from './routes/mastodon/index.js';
import { TokenManager } from './lib/TokenManager.js';
import { FeedSubscription } from './FeedSubscription.js';
import { FirehoseSubscription } from './subscription.js';

/** Static configuration for the bridge; production values come from the env. */
export interface BridgeConfig {
  tokenIssuer: string;
  santaHandle: string;
  robotHandle: string;
  santaMastodonHandle: string;
  /** When absent the host is resolved from santaMastodonHandle via webfinger. */
  santaMastodonHost?: string;
  /** Elf handles that are promoted to admin on init(). */
  ensureElfHandles: Array<string>;
  /** Public base URL of the deployment (default OAuth client metadata). */
  basePath?: string;
}

/**
 * Override points for everything that reaches the outside world. Every seam
 * has a production default; tests pass fakes instead.
 */
export interface BridgeSeams {
  /** Pre-built database (already migrated). */
  db: Database;
  /** Default: real OAuth-backed Bluesky agents (buildAtpClient). */
  agentSource?: (
    handle: string
  ) => Promise<[() => Promise<Agent>, string]> | [() => Promise<Agent>, string];
  /** Default: a real NodeOAuthClient backed by this db (initAtLoginClient). */
  atOauthClient?: NodeOAuthClient;
  didResolver?: DidResolver;
  /** Default: config.ensureElfHandles resolved over the network. */
  ensureElfDids?: ReadonlySet<string>;
  /** Default: PlayerService's real bridgy-fed / Mastodon lookups. */
  bridgedLookups?: BridgedLookups;
}

/**
 * Owns the whole service graph and the `blueskyBridge` decoration that
 * `build()` consumes, so there is a single construction to keep in sync.
 *
 * Lifecycle: `build()` wires everything but starts no background work.
 * `init()` performs the settings bootstrap (timer-free -- safe for tests).
 * `start()` begins the background loops (prod only); `stop()` reverses it.
 */
export class Bridge {
  readonly db: Database;
  readonly returnTokenManager: TokenManager<{ returnUrl: string }>;
  readonly authTokenManager: TokenManager<{
    csrfToken: string;
    startedAt: string;
    handle: string;
    admin?: true;
  }>;
  readonly playerService: PlayerService;
  readonly nudgeSender: NudgeSender;
  readonly dmSender: DmSender;
  readonly feedSubscription: FeedSubscription;
  readonly firehoseSubscription: FirehoseSubscription;
  readonly atOauthClient: NodeOAuthClient;
  readonly didResolver: DidResolver;
  readonly santaAccountDid: string;
  readonly ensureElfDids: ReadonlySet<string>;
  readonly santaAgent: () => Promise<Agent>;
  readonly robotAgent: () => Promise<Agent>;
  readonly blueskyBridge: FastifyInstance['blueskyBridge'];

  private otpSweepInterval: ReturnType<typeof setInterval> | undefined;

  private constructor(
    db: Database,
    returnTokenManager: Bridge['returnTokenManager'],
    authTokenManager: Bridge['authTokenManager'],
    playerService: PlayerService,
    nudgeSender: NudgeSender,
    dmSender: DmSender,
    feedSubscription: FeedSubscription,
    firehoseSubscription: FirehoseSubscription,
    atOauthClient: NodeOAuthClient,
    didResolver: DidResolver,
    santaAccountDid: string,
    ensureElfDids: ReadonlySet<string>,
    santaAgent: () => Promise<Agent>,
    robotAgent: () => Promise<Agent>,
    fullScopeHandles: ReadonlySet<string>
  ) {
    this.db = db;
    this.returnTokenManager = returnTokenManager;
    this.authTokenManager = authTokenManager;
    this.playerService = playerService;
    this.nudgeSender = nudgeSender;
    this.dmSender = dmSender;
    this.feedSubscription = feedSubscription;
    this.firehoseSubscription = firehoseSubscription;
    this.atOauthClient = atOauthClient;
    this.didResolver = didResolver;
    this.santaAccountDid = santaAccountDid;
    this.ensureElfDids = ensureElfDids;
    this.santaAgent = santaAgent;
    this.robotAgent = robotAgent;

    this.blueskyBridge = {
      returnTokenManager,
      authTokenManager,
      playerService,
      db,
      atOauthClient,
      fullScopeHandles,
      santaAccountDid,
      santaAgent,
      robotAgent,
      settingsChanged: async (settings) =>
        Promise.all([
          playerService.settingsChanged(settings),
          nudgeSender.settingsChanged(settings),
          dmSender.settingsChanged(settings),
          feedSubscription.settingsChanged(settings),
        ]),
      didResolver,
    };
  }

  static async build(
    config: BridgeConfig,
    seams: BridgeSeams
  ): Promise<Bridge> {
    const db = seams.db;
    const tokenIssuer = config.tokenIssuer;
    const returnTokenManager = new TokenManager<{ returnUrl: string }>(
      db,
      tokenIssuer,
      `${tokenIssuer}/oauth/login`,
      '7 days'
    );
    const authTokenManager = new TokenManager<{
      csrfToken: string;
      startedAt: string;
      handle: string;
      admin?: true;
    }>(db, tokenIssuer, `${tokenIssuer}/endpoints`, '15 minutes');

    const atOauthClient =
      seams.atOauthClient ??
      (config.basePath == null
        ? (() => {
            throw new Error('basePath is required to build the OAuth client');
          })()
        : await initAtLoginClient({
            database: db,
            basePath: config.basePath,
          }));

    const agentSource =
      seams.agentSource ??
      ((handle: string) => buildAtpClient(atOauthClient, handle));

    const [
      ,
      ,
      [santaAgent, santaAccountDid],
      [robotAgent],
      ensureElfDids,
      santaMastodonHost,
    ] = await Promise.all([
      returnTokenManager.initialize(),
      authTokenManager.initialize(),
      agentSource(config.santaHandle),
      agentSource(config.robotHandle),
      seams.ensureElfDids ?? Bridge.resolveElfDids(config.ensureElfHandles),
      config.santaMastodonHost ??
        Bridge.resolveSantaMastodonHost(config.santaMastodonHandle),
    ]);

    const didResolver =
      seams.didResolver ??
      new DidResolver({
        didCache: new MemoryCache(),
        plcUrl: 'https://plc.directory',
        timeout: 3000,
      });

    const nudgeSender = new NudgeSender(db, robotAgent);
    const dmSender = new DmSender(
      db,
      santaAgent,
      config.santaMastodonHandle,
      santaMastodonHost
    );
    const playerService = new PlayerService(
      db,
      santaAgent,
      santaAccountDid,
      dmSender,
      ensureElfDids,
      config.santaMastodonHandle,
      santaMastodonHost,
      seams.bridgedLookups
    );
    const feedSubscription = new FeedSubscription(db);
    const firehoseSubscription = new FirehoseSubscription(
      db,
      playerService,
      santaAccountDid
    );
    playerService.addListener(
      firehoseSubscription.playersChanged.bind(firehoseSubscription)
    );

    const fullScopeHandles = new Set(
      [config.santaHandle, config.robotHandle].map((s) => s.toLowerCase())
    );

    return new Bridge(
      db,
      returnTokenManager,
      authTokenManager,
      playerService,
      nudgeSender,
      dmSender,
      feedSubscription,
      firehoseSubscription,
      atOauthClient,
      didResolver,
      santaAccountDid,
      ensureElfDids,
      santaAgent,
      robotAgent,
      fullScopeHandles
    );
  }

  private static async resolveElfDids(
    handles: Array<string>
  ): Promise<ReadonlySet<string>> {
    return new Set(
      await Promise.all(handles.map((handle) => resolveHandle(handle.trim())))
    );
  }

  private static async resolveSantaMastodonHost(
    santaMastodonHandle: string
  ): Promise<string> {
    const [, initialHost] = santaMastodonHandle.split('@');
    if (initialHost == null) {
      throw new Error(`Cannot parse instance from ${santaMastodonHandle}`);
    }
    const { host } = await resolveMastodonHandle(
      santaMastodonHandle,
      initialHost
    );
    return host;
  }

  /**
   * Prod bootstrap: load sender settings and promote the configured elf
   * handles to admin. Timer-free, so tests can safely call it too.
   */
  async init(): Promise<void> {
    await Promise.all([
      this.nudgeSender.init(),
      this.dmSender.init(),
      this.playerService.init(),
    ]);
    if (this.ensureElfDids.size > 0) {
      await this.db
        .updateTable('player')
        .set({ admin: 1 })
        .where('did', 'in', Array.from(this.ensureElfDids))
        .execute();
    }
  }

  /** Starts all background work. Never call this from tests. */
  start(): void {
    this.playerService.startBackground();
    void this.feedSubscription.start();
    void this.firehoseSubscription.start();
    this.otpSweepInterval = setInterval(async () => {
      await this.db
        .deleteFrom('otp_login')
        .where('expires', '<', new Date().toISOString())
        .execute();
    }, ms('5m'));
  }

  stop(): void {
    if (this.otpSweepInterval != null) {
      clearInterval(this.otpSweepInterval);
      this.otpSweepInterval = undefined;
    }
    this.playerService.stopBackground();
    this.feedSubscription.stop();
  }
}
