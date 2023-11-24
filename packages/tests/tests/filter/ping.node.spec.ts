import { DefaultPubsubTopic } from "@waku/core";
import type { IFilterSubscription, LightNode } from "@waku/interfaces";
import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";

import { MessageCollector, NimGoNode, tearDownNodes } from "../../src/index.js";

import {
  runNodes,
  TestContentTopic,
  TestDecoder,
  TestEncoder,
  validatePingError
} from "./utils.js";

describe("Waku Filter V2: Ping", function () {
  // Set the timeout for all tests in this suite. Can be overwritten at test level
  this.timeout(10000);
  let waku: LightNode;
  let nwaku: NimGoNode;
  let messageCollector: MessageCollector;

  this.beforeEach(async function () {
    this.timeout(15000);
    [nwaku, waku] = await runNodes(this, [DefaultPubsubTopic]);
    messageCollector = new MessageCollector();
  });

  this.afterEach(async function () {
    this.timeout(15000);
    await tearDownNodes(nwaku, waku);
  });

  it("Ping on subscribed peer", async function () {
    const subscription = await waku.filter.createSubscription([TestDecoder]);
    subscription.addEventListener(
      TestDecoder.contentTopic,
      messageCollector.filterCallback
    );
    // await subscription.subscribe([TestDecoder], messageCollector.callback);
    await waku.lightPush.send(TestEncoder, { payload: utf8ToBytes("M1") });
    expect(await messageCollector.waitForMessages(1)).to.eq(true);

    // If ping is successfull(node has active subscription) we receive a success status code.
    await subscription.ping();

    await waku.lightPush.send(TestEncoder, { payload: utf8ToBytes("M2") });

    // Confirm new messages are received after a ping.
    expect(await messageCollector.waitForMessages(2)).to.eq(true);
  });

  it("Ping on unsubscribed peer", async function () {
    const subscription = await waku.filter.createSubscription([TestDecoder]);
    await subscription.ping();
    await subscription.unsubscribe([TestContentTopic]);

    // Ping imediately after unsubscribe
    await validatePingError(subscription);
  });

  it("Reopen subscription with peer with lost subscription", async function () {
    let subscription: IFilterSubscription;
    const openSubscription = async (): Promise<void> => {
      subscription = await waku.filter.createSubscription([TestDecoder]);
      subscription.addEventListener(
        TestDecoder.contentTopic,
        messageCollector.filterCallback
      );
    };

    const unsubscribe = async (): Promise<void> => {
      await subscription.unsubscribe([TestContentTopic]);
    };

    const pingAndReinitiateSubscription = async (): Promise<void> => {
      try {
        await subscription.ping();
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("peer has no subscriptions")
        ) {
          await openSubscription();
        } else {
          throw error;
        }
      }
    };

    // open subscription & ping -> should pass
    await openSubscription();
    await pingAndReinitiateSubscription();

    // unsubscribe & ping -> should fail and reinitiate subscription
    await unsubscribe();
    await pingAndReinitiateSubscription();

    // ping -> should pass as subscription is reinitiated
    await pingAndReinitiateSubscription();
  });
});
