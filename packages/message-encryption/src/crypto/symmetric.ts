import { etc as secpUtils } from "@noble/secp256k1";

import { Symmetric } from "../constants.js";

import { getSubtle } from "./index.js";

export async function encrypt(
  iv: Uint8Array,
  key: Uint8Array,
  clearText: Uint8Array
): Promise<Uint8Array> {
  return getSubtle()
    .importKey("raw", key, Symmetric.algorithm, false, ["encrypt"])
    .then((cryptoKey) =>
      getSubtle().encrypt({ iv, ...Symmetric.algorithm }, cryptoKey, clearText)
    )
    .then((cipher) => new Uint8Array(cipher));
}

export async function decrypt(
  iv: Uint8Array,
  key: Uint8Array,
  cipherText: Uint8Array
): Promise<Uint8Array> {
  return getSubtle()
    .importKey("raw", key, Symmetric.algorithm, false, ["decrypt"])
    .then((cryptoKey) =>
      getSubtle().decrypt({ iv, ...Symmetric.algorithm }, cryptoKey, cipherText)
    )
    .then((clear) => new Uint8Array(clear));
}

export function generateIv(): Uint8Array {
  return secpUtils.randomBytes(Symmetric.ivSize);
}
