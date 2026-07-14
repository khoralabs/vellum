import type { FlagMap } from "@khoralabs/cli-kit";
import { boolFlag, style } from "@khoralabs/cli-kit";
import { generateIdentity, loadIdentity, saveIdentity } from "@khoralabs/did-key-identity";

import { agentIdentityPath } from "../flows/context";

export async function handleKeygen(flags: FlagMap): Promise<void> {
  const force = boolFlag(flags, "force", "f");
  const json = boolFlag(flags, "json");
  const keyPath = agentIdentityPath(flags);

  if (!force) {
    const existing = await loadIdentity(keyPath);
    if (existing !== undefined) {
      console.error(
        style.error(`Identity already exists at ${keyPath}. Use --force to overwrite.`),
      );
      process.exit(1);
    }
  }

  const signer = await generateIdentity();
  await saveIdentity(keyPath, signer);

  if (json) {
    console.log(JSON.stringify({ did: signer.did, path: keyPath }));
  } else {
    console.log(`DID:  ${signer.did}`);
    console.log(`Saved ${keyPath}`);
  }
}
