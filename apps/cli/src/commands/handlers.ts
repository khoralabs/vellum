import type { FlagMap } from "@khoralabs/cli-kit";

import type { VellumCliContext } from "../flows/context";
import {
  handleChannelAttach,
  handleChannelConnect,
  handleChannelCreate,
  handleChannelJoin,
} from "./channel";
import {
  handleChainCreate,
  handleChainList,
  handleChainSnapshot,
  handleOfferList,
  handleOfferRead,
  handleOfferSendTurn,
  handlePolicyRead,
  handlePolicyValidate,
  handlePortList,
  handlePortRead,
} from "./channel-commands";
import { handleConnect } from "./connect";
import { handleDisconnect } from "./disconnect";
import { handleKeygen } from "./keygen";
import { handleList } from "./list";
import { runSetupCommand } from "./setup";

export async function dispatch(
  ctx: VellumCliContext,
  positional: string[],
  flags: FlagMap,
): Promise<void> {
  const [a, b] = positional;

  if (a === "setup") {
    await runSetupCommand(flags);
    return;
  }

  if (a === "keygen") {
    await handleKeygen(flags);
    return;
  }

  if (a === "channel" && b === "create") {
    await handleChannelCreate(flags);
    return;
  }

  if (a === "channel" && b === "join") {
    await handleChannelJoin(ctx, flags);
    return;
  }

  if (a === "channel" && b === "connect") {
    await handleChannelConnect(ctx, positional, flags);
    return;
  }

  if (a === "channel" && b === "attach") {
    await handleChannelAttach(ctx, positional, flags);
    return;
  }

  if (a === "list") {
    await handleList(flags);
    return;
  }

  if (a === "disconnect") {
    handleDisconnect(positional, flags);
    return;
  }

  if (a === "connect") {
    await handleConnect(ctx, positional, flags);
    return;
  }

  if (a === "chain" && b === "create") {
    await handleChainCreate(flags);
    return;
  }

  if (a === "chain" && b === "list") {
    handleChainList(flags);
    return;
  }

  if (a === "chain" && b === "snapshot") {
    await handleChainSnapshot(flags);
    return;
  }

  if (a === "offer" && b === "list") {
    handleOfferList(flags);
    return;
  }

  if (a === "offer" && b === "read") {
    handleOfferRead(positional, flags);
    return;
  }

  if (a === "offer" && b === "send-turn") {
    await handleOfferSendTurn(flags);
    return;
  }

  if (a === "port" && b === "list") {
    handlePortList(positional, flags);
    return;
  }

  if (a === "port" && b === "read") {
    handlePortRead(positional, flags);
    return;
  }

  if (a === "policy" && b === "read") {
    handlePolicyRead(positional, flags);
    return;
  }

  if (a === "policy" && b === "validate") {
    handlePolicyValidate(positional, flags);
    return;
  }

  throw new Error(`Unknown command: ${positional.join(" ")}`);
}
