/**
 * North-star Vellum host loop (illustrative).
 *
 * Channel attach is separate from chain init. Omit genesisTurn to open an empty
 * graph, then commit the initiator's first expose. `turn.schema` is Standard Schema
 * (validate + jsonSchema draft-2020-12) — pass jsonSchema into Output.object.
 *
 *   const chain = await VellumChain.open(client, { peer })
 *   for await (const turn of chain.turns()) {
 *     if (turn.youAct) {
 *       const body = await generate(turn.schema)
 *       await chain.commit(body)
 *     }
 *   }
 */
import { VellumChain, type VellumClient } from "@khoralabs/vellum-client";

export async function runBilateralLoop(
  client: VellumClient,
  peer: string,
  generate: (schema: {
    readonly "~standard": {
      jsonSchema: { input: (o: { target: string }) => Record<string, unknown> };
    };
  }) => Promise<Record<string, unknown>>,
): Promise<void> {
  const chain = await VellumChain.open(client, { peer });
  for await (const turn of chain.turns()) {
    if (turn.youAct) {
      const body = await generate(turn.schema);
      await chain.commit(body);
    }
  }
}
