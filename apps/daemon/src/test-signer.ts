import type { PersistableSigner } from "@khoralabs/did-key-identity";

/** Minimal signer stub for control-server unit tests. */
export function testControlSigner(did = "did:key:alice"): PersistableSigner {
  return {
    did,
    export: () => "dGVzdA==",
    sign: async () => new Uint8Array(64),
  };
}
