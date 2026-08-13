import {
  type IdentitySecret,
  loadIdentity,
  type PersistableSigner,
} from "@khoralabs/did-key-identity";

import { defaultAgentIdentityPath } from "./default-agent-identity-path";

export type LoadVellumIdentityOptions = {
  keyPath?: string | undefined;
  /** Required when the identity file is sealed (wrapKey or passphrase). */
  identitySecret?: IdentitySecret | undefined;
  env?: NodeJS.ProcessEnv;
};

/** Resolve key path: explicit → `VELLUM_AGENT_KEY_PATH` → default. */
export function resolveVellumIdentityPath(
  opts: Pick<LoadVellumIdentityOptions, "keyPath" | "env"> = {},
): string {
  const env = opts.env ?? process.env;
  return opts.keyPath?.trim() ?? env.VELLUM_AGENT_KEY_PATH?.trim() ?? defaultAgentIdentityPath();
}

/**
 * Load a {@link PersistableSigner} from disk (plaintext or sealed).
 * Returns `undefined` when the file is missing.
 */
export async function loadVellumIdentity(
  opts: LoadVellumIdentityOptions = {},
): Promise<PersistableSigner | undefined> {
  const idPath = resolveVellumIdentityPath(opts);
  return loadIdentity(
    idPath,
    opts.identitySecret !== undefined ? { secret: opts.identitySecret } : {},
  );
}

/**
 * Like {@link loadVellumIdentity} but throws when missing.
 */
export async function requireVellumIdentity(
  opts: LoadVellumIdentityOptions = {},
): Promise<PersistableSigner> {
  const idPath = resolveVellumIdentityPath(opts);
  const signer = await loadVellumIdentity(opts);
  if (signer === undefined) {
    throw new Error(`identity not found at ${idPath}`);
  }
  return signer;
}
