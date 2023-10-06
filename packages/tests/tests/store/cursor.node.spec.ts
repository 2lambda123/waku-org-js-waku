import { createCursor, DecodedMessage, DefaultPubSubTopic } from "@waku/core";
import type { LightNode } from "@waku/interfaces";
import { bytesToUtf8 } from "@waku/utils/bytes";
import { expect } from "chai";

import { makeLogFileName, NimGoNode, tearDownNodes } from "../../src/index.js";

import {
  customPubSubTopic,
  sendMessages,
  startAndConnectLightNode,
  TestContentTopic,
  TestDecoder,
  totalMsgs
} from "./utils.js";

describe("Waku Store, cursor", function () {
  this.timeout(15000);
  let waku: LightNode;
  let waku2: LightNode;
  let nwaku: NimGoNode;

  beforeEach(async function () {
    this.timeout(15000);
    nwaku = new NimGoNode(makeLogFileName(this));
    await nwaku.startWithRetries({ store: true, lightpush: true, relay: true });
    await nwaku.ensureSubscriptions();
  });

  afterEach(async function () {
    this.timeout(15000);
    await tearDownNodes([nwaku], [waku, waku2]);
  });

  [
    [2, 4],
    [0, 20],
    [10, 40],
    [19, 20],
    [19, 50],
    [110, 120]
  ].forEach(([cursorIndex, messageCount]) => {
    it(`Passing a valid cursor at ${cursorIndex} index when there are ${messageCount} messages`, async function () {
      await sendMessages(
        nwaku,
        messageCount,
        TestContentTopic,
        DefaultPubSubTopic
      );
      waku = await startAndConnectLightNode(nwaku);

      // messages in reversed order (first message at last index)
      const messages: DecodedMessage[] = [];
      for await (const page of waku.store.queryGenerator([TestDecoder])) {
        for await (const msg of page.reverse()) {
          messages.push(msg as DecodedMessage);
        }
      }

      // create cursor to extract messages after the cursorIndex
      const cursor = await createCursor(messages[cursorIndex]);

      const messagesAfterCursor: DecodedMessage[] = [];
      for await (const page of waku.store.queryGenerator([TestDecoder], {
        cursor
      })) {
        for await (const msg of page.reverse()) {
          if (msg) {
            messagesAfterCursor.push(msg as DecodedMessage);
          }
        }
      }

      expect(messages.length).be.eql(messageCount);
      expect(messagesAfterCursor.length).be.eql(messageCount - cursorIndex - 1);
      if (cursorIndex == messages.length - 1) {
        // in this case the cursor will return nothin because it points at the end of the list
        expect(messagesAfterCursor).be.eql([]);
      } else {
        expect(bytesToUtf8(messagesAfterCursor[0].payload)).to.be.eq(
          bytesToUtf8(messages[cursorIndex + 1].payload)
        );
        expect(
          bytesToUtf8(
            messagesAfterCursor[messagesAfterCursor.length - 1].payload
          )
        ).to.be.eq(bytesToUtf8(messages[messages.length - 1].payload));
      }
    });
  });

  it("Reusing cursor across nodes", async function () {
    await sendMessages(nwaku, totalMsgs, TestContentTopic, DefaultPubSubTopic);
    waku = await startAndConnectLightNode(nwaku);
    waku2 = await startAndConnectLightNode(nwaku);

    // messages in reversed order (first message at last index)
    const messages: DecodedMessage[] = [];
    for await (const page of waku.store.queryGenerator([TestDecoder])) {
      for await (const msg of page.reverse()) {
        messages.push(msg as DecodedMessage);
      }
    }

    // create cursor to extract messages after the cursorIndex
    const cursor = await createCursor(messages[5]);

    // query node2 with the cursor from node1
    const messagesAfterCursor: DecodedMessage[] = [];
    for await (const page of waku2.store.queryGenerator([TestDecoder], {
      cursor
    })) {
      for await (const msg of page.reverse()) {
        if (msg) {
          messagesAfterCursor.push(msg as DecodedMessage);
        }
      }
    }

    expect(messages.length).be.eql(totalMsgs);
    expect(messagesAfterCursor.length).be.eql(totalMsgs - 6);
    expect(bytesToUtf8(messagesAfterCursor[0].payload)).to.be.eq(
      bytesToUtf8(messages[6].payload)
    );
    expect(
      bytesToUtf8(messagesAfterCursor[messagesAfterCursor.length - 1].payload)
    ).to.be.eq(bytesToUtf8(messages[messages.length - 1].payload));
  });

  it("Passing cursor with wrong message digest", async function () {
    await sendMessages(nwaku, totalMsgs, TestContentTopic, DefaultPubSubTopic);
    waku = await startAndConnectLightNode(nwaku);

    const messages: DecodedMessage[] = [];
    for await (const page of waku.store.queryGenerator([TestDecoder])) {
      for await (const msg of page.reverse()) {
        messages.push(msg as DecodedMessage);
      }
    }
    const cursor = await createCursor(messages[5]);

    // setting a wrong digest
    cursor.digest = new Uint8Array([]);

    const messagesAfterCursor: DecodedMessage[] = [];
    try {
      for await (const page of waku.store.queryGenerator([TestDecoder], {
        cursor
      })) {
        for await (const msg of page.reverse()) {
          if (msg) {
            messagesAfterCursor.push(msg as DecodedMessage);
          }
        }
      }
      expect(messagesAfterCursor.length).to.eql(0);
    } catch (error) {
      if (
        nwaku.type() === "go-waku" &&
        typeof error === "string" &&
        error.includes("History response contains an Error: INVALID_CURSOR")
      ) {
        return;
      }
      throw error instanceof Error
        ? new Error(`Unexpected error: ${error.message}`)
        : error;
    }
  });

  // PubsubTopic is ignored in the cursor. Needs fixing so it throws an error if it doesn't match with Decoder
  it.skip("Passing cursor with wrong pubSubTopic", async function () {
    await sendMessages(nwaku, totalMsgs, TestContentTopic, DefaultPubSubTopic);
    waku = await startAndConnectLightNode(nwaku);

    const messages: DecodedMessage[] = [];
    for await (const page of waku.store.queryGenerator([TestDecoder])) {
      for await (const msg of page.reverse()) {
        messages.push(msg as DecodedMessage);
      }
    }
    const cursor = await createCursor(messages[5], customPubSubTopic);

    const messagesAfterCursor: DecodedMessage[] = [];
    for await (const page of waku.store.queryGenerator([TestDecoder], {
      cursor
    })) {
      for await (const msg of page.reverse()) {
        if (msg) {
          messagesAfterCursor.push(msg as DecodedMessage);
        }
      }
    }
    expect(messagesAfterCursor.length).be.eql(0);
  });
});
