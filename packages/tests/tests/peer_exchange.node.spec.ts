import { bootstrap } from "@libp2p/bootstrap";
import tests from "@libp2p/interface-peer-discovery-compliance-tests";
import {
  Fleet,
  getPredefinedBootstrapNodes,
} from "@waku/core/lib/predefined_bootstrap_nodes";
import { createLightNode } from "@waku/create";
import type { LightNode } from "@waku/interfaces";
import {
  PeerExchangeCodec,
  PeerExchangeDiscovery,
  WakuPeerExchange,
  wakuPeerExchangeDiscovery,
} from "@waku/peer-exchange";
import { expect } from "chai";

import { makeLogFileName } from "../src/log_file.js";
import { Nwaku } from "../src/nwaku.js";

describe("Peer Exchange", () => {
  let waku: LightNode;

  afterEach(async function () {
    !!waku && waku.stop().catch((e) => console.log("Waku failed to stop", e));
  });

  it("Auto discovery", async function () {
    // skipping in CI as this test demonstrates Peer Exchange working with the test fleet
    // but not with locally run nwaku nodes
    if (process.env.CI) {
      this.skip();
    }

    this.timeout(50_000);

    waku = await createLightNode({
      libp2p: {
        peerDiscovery: [
          bootstrap({ list: getPredefinedBootstrapNodes(Fleet.Test, 3) }),
          wakuPeerExchangeDiscovery(),
        ],
      },
    });

    await waku.start();

    const foundPxPeer = await new Promise<boolean>((resolve) => {
      const testNodes = getPredefinedBootstrapNodes(Fleet.Test, 3);
      waku.libp2p.addEventListener("peer:discovery", (evt) => {
        const { multiaddrs } = evt.detail;
        multiaddrs.forEach((ma) => {
          const isBootstrapNode = testNodes.find((n) => n === ma.toString());
          if (!isBootstrapNode) {
            resolve(true);
          }
        });
      });
    });

    expect(foundPxPeer).to.be.true;
  });

  describe("Locally run nodes", () => {
    let waku: LightNode;
    let nwaku1: Nwaku;
    let nwaku2: Nwaku;

    beforeEach(async function () {
      nwaku1 = new Nwaku(makeLogFileName(this) + "1");
      nwaku2 = new Nwaku(makeLogFileName(this) + "2");
    });

    afterEach(async function () {
      !!nwaku1 && nwaku1.stop();
      !!nwaku2 && nwaku2.stop();
      !!waku && waku.stop().catch((e) => console.log("Waku failed to stop", e));
    });

    it("nwaku interop", async function () {
      this.timeout(15_000);

      await nwaku1.start({
        discv5Discovery: true,
        peerExchange: true,
      });

      const enr = (await nwaku1.info()).enrUri;

      await nwaku2.start({
        discv5Discovery: true,
        peerExchange: true,
        discv5BootstrapNode: enr,
      });

      const nwaku1Ma = await nwaku1.getMultiaddrWithId();
      const nwaku2Ma = await nwaku2.getMultiaddrWithId();

      waku = await createLightNode();
      await waku.start();
      await waku.libp2p.dialProtocol(nwaku2Ma, PeerExchangeCodec);

      await new Promise<void>((resolve) => {
        waku.libp2p.peerStore.addEventListener("change:protocols", (evt) => {
          if (evt.detail.protocols.includes(PeerExchangeCodec)) {
            resolve();
          }
        });
      });

      await nwaku2.waitForLog("Discovered px peers via discv5", 10);

      // the ts-ignores are added ref: https://github.com/libp2p/js-libp2p-interfaces/issues/338#issuecomment-1431643645
      const peerExchange = new WakuPeerExchange({
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        connectionManager: waku.libp2p.connectionManager,
        peerStore: waku.libp2p.peerStore,
      });

      const numPeersToRequest = 1;

      const peerInfos = await peerExchange.query({
        numPeers: numPeersToRequest,
      });

      expect(peerInfos.length).to.be.greaterThan(0);
      expect(peerInfos.length).to.be.lessThanOrEqual(numPeersToRequest);
      expect(peerInfos[0].ENR).to.not.be.null;

      const doesMultiaddrExist =
        peerInfos.find(
          (peerInfo) =>
            peerInfo.ENR?.getFullMultiaddrs()?.find((multiaddr) =>
              multiaddr.equals(nwaku1Ma)
            ) !== undefined
        ) !== undefined;
      expect(doesMultiaddrExist).to.be.equal(true);

      expect(waku.libp2p.peerStore.has(await nwaku2.getPeerId())).to.be.true;
    });
  });

  describe.only("compliance test", async function () {
    this.timeout(25_000);

    let waku: LightNode;
    let nwaku1: Nwaku;
    let nwaku2: Nwaku;

    beforeEach(async function () {
      nwaku1 = new Nwaku(makeLogFileName(this) + "1");
      nwaku2 = new Nwaku(makeLogFileName(this) + "2");
    });

    tests({
      async setup() {
        await nwaku1.start({
          discv5Discovery: true,
          peerExchange: true,
        });

        const enr = (await nwaku1.info()).enrUri;

        await nwaku2.start({
          discv5Discovery: true,
          peerExchange: true,
          discv5BootstrapNode: enr,
        });

        waku = await createLightNode();

        await waku.start();
        const nwaku2Ma = await nwaku2.getMultiaddrWithId();

        await waku.libp2p.dialProtocol(nwaku2Ma, PeerExchangeCodec);
        await new Promise<void>((resolve) => {
          waku.libp2p.peerStore.addEventListener("change:protocols", (evt) => {
            if (evt.detail.protocols.includes(PeerExchangeCodec)) {
              resolve();
            }
          });
        });

        // the ts-ignores are added ref: https://github.com/libp2p/js-libp2p-interfaces/issues/338#issuecomment-1431643645
        const components = {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          connectionManager: waku.libp2p.connectionManager,
          peerStore: waku.libp2p.peerStore,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          registrar: waku.libp2p.registrar,
        };

        return new PeerExchangeDiscovery(components);
      },
      teardown: async () => {
        !!nwaku1 && nwaku1.stop();
        !!nwaku2 && nwaku2.stop();
        !!waku && (await waku.stop());
      },
    });
  });
});
