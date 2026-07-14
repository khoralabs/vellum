import type { FlagMap } from "@khoralabs/cli-kit";
import { boolFlag } from "@khoralabs/cli-kit";
import { listLocalVellumRows } from "@khoralabs/vellum-client";

import { dataDirForEnv } from "../flows/context";

export async function handleList(flags: FlagMap): Promise<void> {
  const dataDir = dataDirForEnv(flags);
  const locals = listLocalVellumRows({ dataDir });

  if (boolFlag(flags, "json")) {
    console.log(JSON.stringify(locals, null, 2));
    return;
  }
  if (locals.length === 0) {
    console.log("(no local channels)");
    return;
  }
  console.log("channelId\tstatus\tpid\tcontrolPort");
  for (const r of locals) {
    const pid = r.pid !== undefined ? String(r.pid) : "-";
    const port = r.controlPort !== undefined ? String(r.controlPort) : "-";
    console.log(`${r.channelId}\t${r.status}\t${pid}\t${port}`);
  }
}
