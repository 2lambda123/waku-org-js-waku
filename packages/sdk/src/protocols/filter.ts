import type { Peer } from "@libp2p/interface";
import type { PeerId } from "@libp2p/interface";
import { ConnectionManager, FilterCore } from "@waku/core";
import {
  type Callback,
  type ContentTopic,
  type CoreProtocolResult,
  type CreateSubscriptionResult,
  EConnectionStateEvents,
  type IAsyncIterator,
  type IDecodedMessage,
  type IDecoder,
  type IFilterSDK,
  type IProtoMessage,
  type ISubscriptionSDK,
  type Libp2p,
  type PeerIdStr,
  type ProtocolCreateOptions,
  ProtocolError,
  type ProtocolUseOptions,
  type PubsubTopic,
  type SDKProtocolResult,
  type ShardingParams,
  type SubscribeOptions,
  type Unsubscribe
} from "@waku/interfaces";
import { messageHashStr } from "@waku/message-hash";
import { WakuMessage } from "@waku/proto";
import {
  ensurePubsubTopicIsConfigured,
  groupByContentTopic,
  Logger,
  shardInfoToPubsubTopics,
  toAsyncIterator
} from "@waku/utils";

import { BaseProtocolSDK } from "./base_protocol.js";

type SubscriptionCallback<T extends IDecodedMessage> = {
  decoders: IDecoder<T>[];
  callback: Callback<T>;
};

type ReceivedMessageHashes = {
  all: Set<string>;
  nodes: {
    [peerId: PeerIdStr]: Set<string>;
  };
};

const log = new Logger("sdk:filter");

const DEFAULT_MAX_PINGS = 3;
const DEFAULT_MAX_MISSED_MESSAGES_THRESHOLD = 3;
const DEFAULT_KEEP_ALIVE = 30 * 1000;

const DEFAULT_SUBSCRIBE_OPTIONS = {
  keepAlive: DEFAULT_KEEP_ALIVE
};

export class SubscriptionManager implements ISubscriptionSDK {
  readonly receivedMessagesHashStr: string[] = [];
  private keepAliveTimer: number | null = null;
  private readonly receivedMessagesHashes: ReceivedMessageHashes;
  private peerFailures: Map<string, number> = new Map();
  private missedMessagesByPeer: Map<string, number> = new Map();
  private maxPingFailures: number = DEFAULT_MAX_PINGS;
  private subscribeOptions: SubscribeOptions = DEFAULT_SUBSCRIBE_OPTIONS;
  private maxMissedMessagesThreshold = DEFAULT_MAX_MISSED_MESSAGES_THRESHOLD;

  private contentTopics: ContentTopic[] = [];
  private subscriptionCallbacks: Map<
    ContentTopic,
    SubscriptionCallback<IDecodedMessage>
  > = new Map();

  constructor(
    private readonly pubsubTopic: PubsubTopic,
    private readonly protocol: FilterCore,
    private readonly connectionManager: ConnectionManager,
    private readonly getPeers: () => Peer[],
    private readonly renewPeer: (peerToDisconnect: PeerId) => Promise<Peer>
  ) {
    const allPeerIdStr = this.getPeers().map((p) => p.id.toString());
    this.receivedMessagesHashes = {
      all: new Set(),
      nodes: {
        ...Object.fromEntries(allPeerIdStr.map((peerId) => [peerId, new Set()]))
      }
    };
    allPeerIdStr.forEach((peerId) => this.missedMessagesByPeer.set(peerId, 0));
  }

  private addHash(hash: string, peerIdStr?: string): void {
    this.receivedMessagesHashes.all.add(hash);

    if (peerIdStr) {
      this.receivedMessagesHashes.nodes[peerIdStr].add(hash);
    }
  }

  public async subscribe<T extends IDecodedMessage>(
    decoders: IDecoder<T> | IDecoder<T>[],
    callback: Callback<T>,
    options: SubscribeOptions = DEFAULT_SUBSCRIBE_OPTIONS
  ): Promise<SDKProtocolResult> {
    this.keepAliveTimer = options.keepAlive || DEFAULT_KEEP_ALIVE;
    this.maxPingFailures = options.pingsBeforePeerRenewed || DEFAULT_MAX_PINGS;
    this.maxMissedMessagesThreshold =
      options.maxMissedMessagesThreshold ||
      DEFAULT_MAX_MISSED_MESSAGES_THRESHOLD;

    const decodersArray = Array.isArray(decoders) ? decoders : [decoders];

    // check that all decoders are configured for the same pubsub topic as this subscription
    for (const decoder of decodersArray) {
      if (decoder.pubsubTopic !== this.pubsubTopic) {
        return {
          failures: [
            {
              error: ProtocolError.TOPIC_DECODER_MISMATCH
            }
          ],
          successes: []
        };
      }
    }

    const decodersGroupedByCT = groupByContentTopic(decodersArray);
    const contentTopics = Array.from(decodersGroupedByCT.keys());

    const promises = this.getPeers().map(async (peer) =>
      this.protocol.subscribe(this.pubsubTopic, peer, contentTopics)
    );

    const results = await Promise.allSettled(promises);

    const finalResult = this.handleResult(results, "subscribe");

    // Save the callback functions by content topics so they
    // can easily be removed (reciprocally replaced) if `unsubscribe` (reciprocally `subscribe`)
    // is called for those content topics
    decodersGroupedByCT.forEach((decoders, contentTopic) => {
      // Cast the type because a given `subscriptionCallbacks` map may hold
      // Decoder that decode to different implementations of `IDecodedMessage`
      const subscriptionCallback = {
        decoders,
        callback
      } as unknown as SubscriptionCallback<IDecodedMessage>;

      // The callback and decoder may override previous values, this is on
      // purpose as the user may call `subscribe` to refresh the subscription
      this.subscriptionCallbacks.set(contentTopic, subscriptionCallback);
    });

    this.contentTopics = contentTopics;
    this.subscribeOptions = options;
    this.startBackgroundProcess(options);

    return finalResult;
  }

  public async unsubscribe(
    contentTopics: ContentTopic[]
  ): Promise<SDKProtocolResult> {
    const promises = this.getPeers().map(async (peer) => {
      const response = await this.protocol.unsubscribe(
        this.pubsubTopic,
        peer,
        contentTopics
      );

      contentTopics.forEach((contentTopic: string) => {
        this.subscriptionCallbacks.delete(contentTopic);
      });

      return response;
    });

    const results = await Promise.allSettled(promises);
    const finalResult = this.handleResult(results, "unsubscribe");

    if (this.subscriptionCallbacks.size === 0) {
      this.stopBackgroundRoutine();
    }

    return finalResult;
  }

  public async ping(peerId?: PeerId): Promise<SDKProtocolResult> {
    const peers = peerId ? [peerId] : this.getPeers().map((peer) => peer.id);

    const promises = peers.map((peerId) => this.pingSpecificPeer(peerId));
    const results = await Promise.allSettled(promises);

    return this.handleResult(results, "ping");
  }

  public async unsubscribeAll(): Promise<SDKProtocolResult> {
    const promises = this.getPeers().map(async (peer) =>
      this.protocol.unsubscribeAll(this.pubsubTopic, peer)
    );

    const results = await Promise.allSettled(promises);

    this.subscriptionCallbacks.clear();

    const finalResult = this.handleResult(results, "unsubscribeAll");

    this.stopBackgroundRoutine();

    return finalResult;
  }

  private async validateMessage(): Promise<void> {
    for (const hash of this.receivedMessagesHashes.all) {
      for (const [peerIdStr, hashes] of Object.entries(
        this.receivedMessagesHashes.nodes
      )) {
        if (!hashes.has(hash)) {
          this.incrementMissedMessageCount(peerIdStr);
          if (this.shouldRenewPeer(peerIdStr)) {
            log.info(
              `Peer ${peerIdStr} has missed too many messages, renewing.`
            );
            const peerId = this.getPeers().find(
              (p) => p.id.toString() === peerIdStr
            )?.id;
            if (!peerId) {
              log.error(
                `Unexpected Error: Peer ${peerIdStr} not found in connected peers.`
              );
              continue;
            }
            try {
              await this.renewAndSubscribePeer(peerId);
            } catch (error) {
              log.error(`Failed to renew peer ${peerIdStr}: ${error}`);
            }
          }
        }
      }
    }
  }

  async processIncomingMessage(
    message: WakuMessage,
    peerIdStr: string
  ): Promise<void> {
    const hashedMessageStr = messageHashStr(
      this.pubsubTopic,
      message as IProtoMessage
    );

    this.addHash(hashedMessageStr, peerIdStr);
    void this.validateMessage();

    if (this.receivedMessagesHashStr.includes(hashedMessageStr)) {
      log.info("Message already received, skipping");
      return;
    }
    this.receivedMessagesHashStr.push(hashedMessageStr);

    const { contentTopic } = message;
    const subscriptionCallback = this.subscriptionCallbacks.get(contentTopic);
    if (!subscriptionCallback) {
      log.error("No subscription callback available for ", contentTopic);
      return;
    }
    log.info(
      "Processing message with content topic ",
      contentTopic,
      " on pubsub topic ",
      this.pubsubTopic
    );
    await pushMessage(subscriptionCallback, this.pubsubTopic, message);
  }

  private handleResult(
    results: PromiseSettledResult<CoreProtocolResult>[],
    type: "ping" | "subscribe" | "unsubscribe" | "unsubscribeAll"
  ): SDKProtocolResult {
    const result: SDKProtocolResult = { failures: [], successes: [] };

    for (const promiseResult of results) {
      if (promiseResult.status === "rejected") {
        log.error(
          `Failed to resolve ${type} promise successfully: `,
          promiseResult.reason
        );
        result.failures.push({ error: ProtocolError.GENERIC_FAIL });
      } else {
        const coreResult = promiseResult.value;
        if (coreResult.failure) {
          result.failures.push(coreResult.failure);
        } else {
          result.successes.push(coreResult.success);
        }
      }
    }
    return result;
  }

  private async pingSpecificPeer(peerId: PeerId): Promise<CoreProtocolResult> {
    const peer = this.getPeers().find((p) => p.id.equals(peerId));
    if (!peer) {
      return {
        success: null,
        failure: {
          peerId,
          error: ProtocolError.NO_PEER_AVAILABLE
        }
      };
    }

    try {
      const result = await this.protocol.ping(peer);
      if (result.failure) {
        await this.handlePeerFailure(peerId);
      } else {
        this.peerFailures.delete(peerId.toString());
      }
      return result;
    } catch (error) {
      await this.handlePeerFailure(peerId);
      return {
        success: null,
        failure: {
          peerId,
          error: ProtocolError.GENERIC_FAIL
        }
      };
    }
  }

  private async handlePeerFailure(peerId: PeerId): Promise<void> {
    const failures = (this.peerFailures.get(peerId.toString()) || 0) + 1;
    this.peerFailures.set(peerId.toString(), failures);

    if (failures > this.maxPingFailures) {
      try {
        await this.renewAndSubscribePeer(peerId);
        this.peerFailures.delete(peerId.toString());
      } catch (error) {
        log.error(`Failed to renew peer ${peerId.toString()}: ${error}.`);
      }
    }
  }

  private async renewAndSubscribePeer(
    peerId: PeerId
  ): Promise<Peer | undefined> {
    try {
      const newPeer = await this.renewPeer(peerId);
      await this.protocol.subscribe(
        this.pubsubTopic,
        newPeer,
        Array.from(this.subscriptionCallbacks.keys())
      );

      this.receivedMessagesHashes.nodes[newPeer.id.toString()] = new Set();
      this.missedMessagesByPeer.set(newPeer.id.toString(), 0);

      return newPeer;
    } catch (error) {
      log.warn(`Failed to renew peer ${peerId.toString()}: ${error}.`);
      return;
    } finally {
      this.peerFailures.delete(peerId.toString());
      this.missedMessagesByPeer.delete(peerId.toString());
      delete this.receivedMessagesHashes.nodes[peerId.toString()];
    }
  }

  private startBackgroundProcess(options: SubscribeOptions): void {
    if (options?.keepAlive) {
      this.startKeepAlivePings(options.keepAlive);
    }
    this.startNetworkMonitoring();
  }

  private stopBackgroundRoutine(): void {
    this.stopKeepAlivePings();
    this.stopNetworkMonitoring();
  }

  private startKeepAlivePings(interval: number): void {
    if (this.keepAliveTimer) {
      log.info("Recurring pings already set up.");
      return;
    }

    this.keepAliveTimer = setInterval(() => {
      void this.ping().catch((error) => {
        log.error("Error in keep-alive ping cycle:", error);
      });
    }, interval) as unknown as number;
  }

  private stopKeepAlivePings(): void {
    if (!this.keepAliveTimer) {
      log.info("Already stopped recurring pings.");
      return;
    }

    log.info("Stopping recurring pings.");
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private startNetworkMonitoring(): void {
    this.connectionManager.addEventListener(
      EConnectionStateEvents.CONNECTION_STATUS,
      this.networkStateListener as (v: CustomEvent<boolean>) => void
    );
  }

  private stopNetworkMonitoring(): void {
    this.connectionManager.removeEventListener(
      EConnectionStateEvents.CONNECTION_STATUS,
      this.networkStateListener as (v: CustomEvent<boolean>) => void
    );
  }

  private async networkStateListener({
    detail: isConnected
  }: CustomEvent<boolean>): Promise<void> {
    if (!isConnected) {
      this.stopKeepAlivePings();
      return;
    }

    try {
      const result = await this.ping();
      const renewPeerPromises = result.failures.map(
        async (v): Promise<void> => {
          if (v.peerId) {
            const peer = await this.protocol.peerStore.get(v.peerId);
            await this.renewPeer(v.peerId);
            await this.protocol.subscribe(
              this.pubsubTopic,
              peer,
              this.contentTopics
            );
          }
        }
      );

      await Promise.all(renewPeerPromises);
    } catch (err) {
      log.error(`networkStateListener failed to recover: ${err}`);
    }

    this.startKeepAlivePings(
      this.subscribeOptions?.keepAlive || DEFAULT_SUBSCRIBE_OPTIONS.keepAlive
    );
  }

  private incrementMissedMessageCount(peerIdStr: string): void {
    const currentCount = this.missedMessagesByPeer.get(peerIdStr) || 0;
    this.missedMessagesByPeer.set(peerIdStr, currentCount + 1);
  }

  private shouldRenewPeer(peerIdStr: string): boolean {
    const missedMessages = this.missedMessagesByPeer.get(peerIdStr) || 0;
    return missedMessages > this.maxMissedMessagesThreshold;
  }
}

class FilterSDK extends BaseProtocolSDK implements IFilterSDK {
  public readonly protocol: FilterCore;
  private readonly _connectionManager: ConnectionManager;

  private activeSubscriptions = new Map<string, SubscriptionManager>();

  constructor(
    connectionManager: ConnectionManager,
    libp2p: Libp2p,
    options?: ProtocolCreateOptions
  ) {
    super(
      new FilterCore(
        async (pubsubTopic, wakuMessage, peerIdStr) => {
          const subscription = this.getActiveSubscription(pubsubTopic);
          if (!subscription) {
            log.error(
              `No subscription locally registered for topic ${pubsubTopic}`
            );
            return;
          }

          await subscription.processIncomingMessage(wakuMessage, peerIdStr);
        },
        libp2p,
        options
      ),
      connectionManager,
      { numPeersToUse: options?.numPeersToUse }
    );

    this.protocol = this.core as FilterCore;
    this._connectionManager = connectionManager;

    this.activeSubscriptions = new Map();
  }

  //TODO: move to SubscriptionManager
  private getActiveSubscription(
    pubsubTopic: PubsubTopic
  ): SubscriptionManager | undefined {
    return this.activeSubscriptions.get(pubsubTopic);
  }

  private setActiveSubscription(
    pubsubTopic: PubsubTopic,
    subscription: SubscriptionManager
  ): SubscriptionManager {
    this.activeSubscriptions.set(pubsubTopic, subscription);
    return subscription;
  }

  /**
   * Creates a new subscription to the given pubsub topic.
   * The subscription is made to multiple peers for decentralization.
   * @param pubsubTopicShardInfo The pubsub topic to subscribe to.
   * @returns The subscription object.
   */
  async createSubscription(
    pubsubTopicShardInfo: ShardingParams | PubsubTopic,
    options?: ProtocolUseOptions
  ): Promise<CreateSubscriptionResult> {
    options = {
      autoRetry: true,
      ...options
    } as ProtocolUseOptions;

    const pubsubTopic =
      typeof pubsubTopicShardInfo == "string"
        ? pubsubTopicShardInfo
        : shardInfoToPubsubTopics(pubsubTopicShardInfo)?.[0];

    ensurePubsubTopicIsConfigured(pubsubTopic, this.protocol.pubsubTopics);

    const hasPeers = await this.hasPeers(options);
    if (!hasPeers) {
      return {
        error: ProtocolError.NO_PEER_AVAILABLE,
        subscription: null
      };
    }

    log.info(
      `Creating filter subscription with ${this.connectedPeers.length} peers: `,
      this.connectedPeers.map((peer) => peer.id.toString())
    );

    const subscription =
      this.getActiveSubscription(pubsubTopic) ??
      this.setActiveSubscription(
        pubsubTopic,
        new SubscriptionManager(
          pubsubTopic,
          this.protocol,
          this._connectionManager,
          () => this.connectedPeers,
          this.renewPeer.bind(this)
        )
      );

    return {
      error: null,
      subscription
    };
  }

  //TODO: remove this dependency on IReceiver
  /**
   * This method is used to satisfy the `IReceiver` interface.
   *
   * @hidden
   *
   * @param decoders The decoders to use for the subscription.
   * @param callback The callback function to use for the subscription.
   * @param opts Optional protocol options for the subscription.
   *
   * @returns A Promise that resolves to a function that unsubscribes from the subscription.
   *
   * @remarks
   * This method should not be used directly.
   * Instead, use `createSubscription` to create a new subscription.
   */
  async subscribe<T extends IDecodedMessage>(
    decoders: IDecoder<T> | IDecoder<T>[],
    callback: Callback<T>,
    options: SubscribeOptions = DEFAULT_SUBSCRIBE_OPTIONS
  ): Promise<Unsubscribe> {
    const uniquePubsubTopics = this.getUniquePubsubTopics<T>(decoders);

    if (uniquePubsubTopics.length === 0) {
      throw Error(
        "Failed to subscribe: no pubsubTopic found on decoders provided."
      );
    }

    if (uniquePubsubTopics.length > 1) {
      throw Error(
        "Failed to subscribe: all decoders should have the same pubsub topic. Use createSubscription to be more agile."
      );
    }

    const { subscription, error } = await this.createSubscription(
      uniquePubsubTopics[0]
    );

    if (error) {
      throw Error(`Failed to create subscription: ${error}`);
    }

    await subscription.subscribe(decoders, callback, options);

    const contentTopics = Array.from(
      groupByContentTopic(
        Array.isArray(decoders) ? decoders : [decoders]
      ).keys()
    );

    return async () => {
      await subscription.unsubscribe(contentTopics);
    };
  }

  public toSubscriptionIterator<T extends IDecodedMessage>(
    decoders: IDecoder<T> | IDecoder<T>[]
  ): Promise<IAsyncIterator<T>> {
    return toAsyncIterator(this, decoders);
  }

  private getUniquePubsubTopics<T extends IDecodedMessage>(
    decoders: IDecoder<T> | IDecoder<T>[]
  ): string[] {
    if (!Array.isArray(decoders)) {
      return [decoders.pubsubTopic];
    }

    if (decoders.length === 0) {
      return [];
    }

    const pubsubTopics = new Set(decoders.map((d) => d.pubsubTopic));

    return [...pubsubTopics];
  }
}

export function wakuFilter(
  connectionManager: ConnectionManager,
  init?: ProtocolCreateOptions
): (libp2p: Libp2p) => IFilterSDK {
  return (libp2p: Libp2p) => new FilterSDK(connectionManager, libp2p, init);
}

async function pushMessage<T extends IDecodedMessage>(
  subscriptionCallback: SubscriptionCallback<T>,
  pubsubTopic: PubsubTopic,
  message: WakuMessage
): Promise<void> {
  const { decoders, callback } = subscriptionCallback;

  const { contentTopic } = message;
  if (!contentTopic) {
    log.warn("Message has no content topic, skipping");
    return;
  }

  try {
    const decodePromises = decoders.map((dec) =>
      dec
        .fromProtoObj(pubsubTopic, message as IProtoMessage)
        .then((decoded) => decoded || Promise.reject("Decoding failed"))
    );

    const decodedMessage = await Promise.any(decodePromises);

    await callback(decodedMessage);
  } catch (e) {
    log.error("Error decoding message", e);
  }
}
