import path from "node:path";

/** Matches `VellumPool` attachment data dirs. */
export function vellumPoolAttachmentDataDir(
  dataDirRoot: string,
  did: string,
  channelId: string,
): string {
  return path.join(
    path.resolve(dataDirRoot),
    encodeURIComponent(did),
    encodeURIComponent(channelId),
  );
}
