import { createLightNode } from "@waku/create";
import { DnsNodeDiscovery, wakuDnsDiscovery } from "@waku/dns-discovery";
import { expect } from "chai";

describe.only("DNS Node Discovery [live data]", function () {
  const publicKey = "AOGECG2SPND25EEFMAJ5WF3KSGJNSGV356DSTL2YVLLZWIV6SAYBM";
  const fqdn = "prod.nodes.status.im";
  const enrTree = `enrtree://${publicKey}@${fqdn}`;

  before(function () {
    if (process.env.CI) {
      this.skip();
    }
  });

  it(`should use DNS peer discovery with light client`, async function () {
    this.timeout(100000);
    const maxQuantity = 3;

    const nodeRequirements = {
      relay: maxQuantity,
      store: maxQuantity,
      filter: maxQuantity,
      lightPush: maxQuantity,
    };

    const waku = await createLightNode({
      libp2p: {
        peerDiscovery: [wakuDnsDiscovery(enrTree, nodeRequirements)],
      },
    });

    await waku.start();
  });
});

describe("Manual: DNS Node Discovery [live data]", function () {
  const publicKey = "AOGECG2SPND25EEFMAJ5WF3KSGJNSGV356DSTL2YVLLZWIV6SAYBM";
  const fqdn = "prod.nodes.status.im";
  const enrTree = `enrtree://${publicKey}@${fqdn}`;
  const maxQuantity = 3;

  before(function () {
    if (process.env.CI) {
      this.skip();
    }
  });

  it(`should retrieve ${maxQuantity} multiaddrs for test.waku.nodes.status.im`, async function () {
    this.timeout(10000);
    // Google's dns server address. Needs to be set explicitly to run in CI
    const dnsNodeDiscovery = DnsNodeDiscovery.dnsOverHttp();

    const peers = await dnsNodeDiscovery.getPeers([enrTree], {
      relay: maxQuantity,
      store: maxQuantity,
      filter: maxQuantity,
      lightPush: maxQuantity,
    });

    console.log(peers.length);

    expect(peers.length).to.eq(maxQuantity);

    const multiaddrs = peers.map((peer) => peer.multiaddrs).flat();

    console.log(`received ${multiaddrs.length} multiaddrs`);

    const seen: string[] = [];
    for (const ma of multiaddrs) {
      expect(ma).to.not.be.undefined;
      expect(seen).to.not.include(ma!.toString());
      seen.push(ma!.toString());
    }
  });
});
