/** Lean filesystem path helpers — no client/daemon/session imports. */
export {
  cfgDataDir,
  channelDir,
  channelSqlitePath,
  channelVellumControlPath,
  encodeChannelIdForPath,
  type VellumPathConfig,
  vellumStoreRoot,
} from "./contracts/paths";
export { vellumPoolAttachmentDataDir } from "./pool/paths";
