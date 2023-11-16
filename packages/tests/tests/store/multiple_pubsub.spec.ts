import { createDecoder, waitForRemotePeer } from "@waku/core";
import type { ContentTopicInfo, IMessage, LightNode } from "@waku/interfaces";
import { createLightNode, Protocols } from "@waku/sdk";
import { contentTopicToPubsubTopic } from "@waku/utils";
import { expect } from "chai";

import {
  makeLogFileName,
  NimGoNode,
  NOISE_KEY_1,
  tearDownNodes
} from "../../src/index.js";

import {
  customContentTopic1,
  customContentTopic2,
  customDecoder1,
  customDecoder2,
  customShardedPubsubTopic1,
  customShardedPubsubTopic2,
  processQueriedMessages,
  sendMessages,
  sendMessagesAutosharding,
  shardInfo1,
  shardInfoBothShards,
  startAndConnectLightNode,
  totalMsgs
} from "./utils.js";

describe("Waku Store, custom pubsub topic", function () {
  this.timeout(15000);
  let waku: LightNode;
  let nwaku: NimGoNode;
  let nwaku2: NimGoNode;

  beforeEach(async function () {
    this.timeout(15000);
    nwaku = new NimGoNode(makeLogFileName(this));
    await nwaku.start({
      store: true,
      pubsubTopic: [customShardedPubsubTopic1, customShardedPubsubTopic2],
      relay: true
    });
    await nwaku.ensureSubscriptions([
      customShardedPubsubTopic1,
      customShardedPubsubTopic2
    ]);
  });

  afterEach(async function () {
    this.timeout(15000);
    await tearDownNodes([nwaku, nwaku2], waku);
  });

  it("Generator, custom pubsub topic", async function () {
    await sendMessages(
      nwaku,
      totalMsgs,
      customContentTopic1,
      customShardedPubsubTopic1
    );
    waku = await startAndConnectLightNode(nwaku, [], shardInfo1);
    const messages = await processQueriedMessages(
      waku,
      [customDecoder1],
      customShardedPubsubTopic1
    );

    expect(messages?.length).eq(totalMsgs);
    const result = messages?.findIndex((msg) => {
      return msg.payload![0]! === 0;
    });
    expect(result).to.not.eq(-1);
  });

  it("Generator, 2 different pubsubtopics", async function () {
    this.timeout(10000);

    const totalMsgs = 10;
    await sendMessages(
      nwaku,
      totalMsgs,
      customContentTopic1,
      customShardedPubsubTopic1
    );
    await sendMessages(
      nwaku,
      totalMsgs,
      customContentTopic2,
      customShardedPubsubTopic2
    );

    waku = await startAndConnectLightNode(nwaku, [], shardInfoBothShards);

    const customMessages = await processQueriedMessages(
      waku,
      [customDecoder1],
      customShardedPubsubTopic1
    );
    expect(customMessages?.length).eq(totalMsgs);
    const result1 = customMessages?.findIndex((msg) => {
      return msg.payload![0]! === 0;
    });
    expect(result1).to.not.eq(-1);

    const testMessages = await processQueriedMessages(
      waku,
      [customDecoder2],
      customShardedPubsubTopic2
    );
    expect(testMessages?.length).eq(totalMsgs);
    const result2 = testMessages?.findIndex((msg) => {
      return msg.payload![0]! === 0;
    });
    expect(result2).to.not.eq(-1);
  });

  it("Generator, 2 nwaku nodes each with different pubsubtopics", async function () {
    this.timeout(10000);

    // Set up and start a new nwaku node with Default Pubsubtopic
    nwaku2 = new NimGoNode(makeLogFileName(this) + "2");
    await nwaku2.start({
      store: true,
      pubsubTopic: [customShardedPubsubTopic2],
      relay: true
    });
    await nwaku2.ensureSubscriptions([customShardedPubsubTopic2]);

    const totalMsgs = 10;
    await sendMessages(
      nwaku,
      totalMsgs,
      customContentTopic1,
      customShardedPubsubTopic1
    );
    await sendMessages(
      nwaku2,
      totalMsgs,
      customContentTopic2,
      customShardedPubsubTopic2
    );

    waku = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
      shardInfo: shardInfoBothShards
    });
    await waku.start();

    await waku.dial(await nwaku.getMultiaddrWithId());
    await waku.dial(await nwaku2.getMultiaddrWithId());
    await waitForRemotePeer(waku, [Protocols.Store]);

    let customMessages: IMessage[] = [];
    let testMessages: IMessage[] = [];

    while (
      customMessages.length != totalMsgs ||
      testMessages.length != totalMsgs
    ) {
      customMessages = await processQueriedMessages(
        waku,
        [customDecoder1],
        customShardedPubsubTopic1
      );
      testMessages = await processQueriedMessages(
        waku,
        [customDecoder2],
        customShardedPubsubTopic2
      );
    }
  });
});

describe("Waku Store (Autosharding), custom pubsub topic", function () {
  this.timeout(15000);
  let waku: LightNode;
  let nwaku: NimGoNode;
  let nwaku2: NimGoNode;

  const customContentTopic1 = "/waku/2/content/utf8";
  const customContentTopic2 = "/myapp/1/latest/proto";
  const clusterId = 1;
  const autoshardingPubsubTopic1 = contentTopicToPubsubTopic(
    customContentTopic1,
    clusterId
  );
  const autoshardingPubsubTopic2 = contentTopicToPubsubTopic(
    customContentTopic2,
    clusterId
  );
  const contentTopicInfo1: ContentTopicInfo = {
    clusterId,
    contentTopics: [customContentTopic1]
  };
  const customDecoder1 = createDecoder(customContentTopic1, {
    clusterId
  });
  const customDecoder2 = createDecoder(customContentTopic2, {
    clusterId
  });
  const contentTopicInfoBothShards: ContentTopicInfo = {
    clusterId,
    contentTopics: [customContentTopic1, customContentTopic2]
  };

  beforeEach(async function () {
    this.timeout(15000);
    nwaku = new NimGoNode(makeLogFileName(this));
    await nwaku.start({
      store: true,
      pubsubTopic: [autoshardingPubsubTopic1, autoshardingPubsubTopic2],
      relay: true
    });
    await nwaku.ensureSubscriptionsAutosharding([
      customContentTopic1,
      customContentTopic2
    ]);
  });

  afterEach(async function () {
    this.timeout(15000);
    await tearDownNodes([nwaku, nwaku2], waku);
  });

  it("Generator, custom pubsub topic", async function () {
    await sendMessagesAutosharding(nwaku, totalMsgs, customContentTopic1);
    waku = await startAndConnectLightNode(nwaku, [], contentTopicInfo1);
    const messages = await processQueriedMessages(
      waku,
      [customDecoder1],
      autoshardingPubsubTopic1
    );

    expect(messages?.length).eq(totalMsgs);
    const result = messages?.findIndex((msg) => {
      return msg.payload![0]! === 0;
    });
    expect(result).to.not.eq(-1);
  });

  it("Generator, 2 different pubsubtopics", async function () {
    this.timeout(10000);

    const totalMsgs = 10;
    await sendMessagesAutosharding(nwaku, totalMsgs, customContentTopic1);
    await sendMessagesAutosharding(nwaku, totalMsgs, customContentTopic2);

    waku = await startAndConnectLightNode(
      nwaku,
      [],
      contentTopicInfoBothShards
    );

    const customMessages = await processQueriedMessages(
      waku,
      [customDecoder1],
      autoshardingPubsubTopic1
    );
    expect(customMessages?.length).eq(totalMsgs);
    const result1 = customMessages?.findIndex((msg) => {
      return msg.payload![0]! === 0;
    });
    expect(result1).to.not.eq(-1);

    const testMessages = await processQueriedMessages(
      waku,
      [customDecoder2],
      autoshardingPubsubTopic2
    );
    expect(testMessages?.length).eq(totalMsgs);
    const result2 = testMessages?.findIndex((msg) => {
      return msg.payload![0]! === 0;
    });
    expect(result2).to.not.eq(-1);
  });

  it("Generator, 2 nwaku nodes each with different pubsubtopics", async function () {
    this.timeout(10000);

    // Set up and start a new nwaku node with Default Pubsubtopic
    nwaku2 = new NimGoNode(makeLogFileName(this) + "2");
    await nwaku2.start({
      store: true,
      pubsubTopic: [autoshardingPubsubTopic2],
      relay: true
    });
    await nwaku2.ensureSubscriptionsAutosharding([customContentTopic2]);

    const totalMsgs = 10;
    await sendMessagesAutosharding(nwaku, totalMsgs, customContentTopic1);
    await sendMessagesAutosharding(nwaku2, totalMsgs, customContentTopic2);

    waku = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
      shardInfo: contentTopicInfoBothShards
    });
    await waku.start();

    await waku.dial(await nwaku.getMultiaddrWithId());
    await waku.dial(await nwaku2.getMultiaddrWithId());
    await waitForRemotePeer(waku, [Protocols.Store]);

    let customMessages: IMessage[] = [];
    let testMessages: IMessage[] = [];

    while (
      customMessages.length != totalMsgs ||
      testMessages.length != totalMsgs
    ) {
      customMessages = await processQueriedMessages(
        waku,
        [customDecoder1],
        autoshardingPubsubTopic1
      );
      testMessages = await processQueriedMessages(
        waku,
        [customDecoder2],
        autoshardingPubsubTopic2
      );
    }
  });
});
