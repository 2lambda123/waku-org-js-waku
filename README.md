# js-waku

A JavaScript implementation of the [Waku v2 protocol](https://specs.vac.dev/specs/waku/v2/waku-v2).

## Waku Protocol Support

- ✔: Supported
- 🚧: Implementation in progress
- ⛔: Support is not planned

| Spec | Implementation Status |
| ---- | -------------- |
|[6/WAKU1](https://rfc.vac.dev/spec/6)|⛔|
|[7/WAKU-DATA](https://rfc.vac.dev/spec/7)|⛔|
|[8/WAKU-MAIL](https://rfc.vac.dev/spec/8)|⛔|
|[9/WAKU-RPC](https://rfc.vac.dev/spec/9)|⛔|
|[10/WAKU2](https://rfc.vac.dev/spec/10)|🚧|
|[11/WAKU2-RELAY](https://rfc.vac.dev/spec/11)|✔|
|[12/WAKU2-FILTER](https://rfc.vac.dev/spec/12)||
|[13/WAKU2-STORE](https://rfc.vac.dev/spec/13)|🚧|
|[14/WAKU2-MESSAGE](https://rfc.vac.dev/spec/14)|✔|
|[15/WAKU2-BRIDGE](https://rfc.vac.dev/spec/15)||
|[16/WAKU2-RPC](https://rfc.vac.dev/spec/16)|⛔|
|[17/WAKU2-RLNRELAY](https://rfc.vac.dev/spec/17)||
|[18/WAKU2-SWAP](https://rfc.vac.dev/spec/18)||

## This is a Work In Progress

You can track progress on the [project board](https://github.com/status-im/js-waku/projects/1).

## Examples

## Chat app

A node chat app is provided as a working example of the library.
It is interoperable with the [nim-waku chat app example](https://github.com/status-im/nim-waku/blob/master/examples/v2/chat2.nim).
To run the chat app:

```shell
npm install
npm run chat:app -- --staticNode /ip4/134.209.139.210/tcp/30303/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ
```

You can also specify an optional `listenAddr` parameter (.e.g `--listenAddr /ip4/0.0.0.0/tcp/55123`).
This is only useful if you want a remote node to dial to your chat app, 
it is not necessary in normal usage when you just connect to the fleet.

## Contributing

To build and test this repository, you need:
  
  - [Node.js & npm](https://nodejs.org/en/)
  - [bufbuild](https://github.com/bufbuild/buf)
  - [protoc](https://grpc.io/docs/protoc-installation/) 

To ensure interoperability with [nim-waku](https://github.com/status-im/nim-waku/), some tests are run against a nim-waku node.
This is why `nim-waku` is present as a [git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules), which itself contain several submodules.
At this stage, it is not possible to exclude nim-waku tests, hence `git submodule update --init --recursive` is run before testing (see [`pretest` script](https://github.com/status-im/js-waku/blob/main/package.json)).

To build nim-waku, you also need [Rust](https://www.rust-lang.org/tools/install).

