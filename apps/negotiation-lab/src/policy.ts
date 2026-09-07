import { type AvailablePeerPort, parseNegotiationTurnEnvelope } from "@khoralabs/obp-nbc/host";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";

import type { NegotiationPolicy, PolicyContext, TokenUsage } from "./types.ts";

const MAX_MODEL_STEPS = 6;

const DEFAULT_PURPOSE =
  "Agree on a reusable bilateral orchestration convention for recurring coordination of the same purpose. Prefer a protocol shape that future repeats can bind in fewer turns.";

const portSchema = z.object({
  kind: z.string().min(1),
  promise: z.string().min(1),
  /** JSON Schema document encoded as a string; use "" when none. */
  bind_policy_json: z.string(),
  terminal: z.boolean(),
  max_bindings: z.number().int().min(1),
});

/** Flat schemas avoid OpenAI response_format `oneOf` / free-form object bans. */
const openingModelSchema = z.object({
  disconnect: z.boolean(),
  expose: z.array(portSchema),
});

const continueModelSchema = z.object({
  disconnect: z.boolean(),
  bind: z.object({
    portId: z.string(),
    payload_json: z.string(),
  }),
  expose: z.array(portSchema),
});

export function defaultPurpose(): string {
  return DEFAULT_PURPOSE;
}

function requireGatewayKey(): void {
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("AI_GATEWAY_API_KEY environment variable not set");
  }
}

function usageFrom(result: {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}): TokenUsage {
  return {
    input: result.usage?.inputTokens ?? 0,
    output: result.usage?.outputTokens ?? 0,
    total: result.usage?.totalTokens ?? 0,
  };
}

function memoryBlock(ctx: PolicyContext): string {
  const general = ctx.memory.general.trim() || "(empty)";
  const peer = ctx.memory.peer.trim() || "(empty)";
  return [
    "## Scoped memory (only what you may use)",
    "### general.md",
    general,
    "### current peer.md",
    peer,
  ].join("\n");
}

function systemPrompt(ctx: PolicyContext): string {
  return [
    "You are an NBC negotiation agent in a bilateral open→snapshot→commit loop.",
    `Your DID: ${ctx.actorDid}`,
    `Peer DID: ${ctx.peerDid}`,
    `Purpose: ${ctx.purpose}`,
    "Create and bind a reusable orchestration convention. Port kinds, promises, bind-policy fields, and payload vocabulary are yours to choose.",
    "Emit exactly one structured turn: opening expose, continue bind (optionally expose), or disconnect.",
    "When a peer port is available and compatible with a known convention, bind promptly.",
    "To leave, set disconnect=true; otherwise set disconnect=false and fill expose/bind.",
    'bind_policy_json and payload_json are JSON object strings, or "" when unused.',
    'When exposing a port that expects a payload, bind_policy_json MUST be a JSON Schema object whose root includes "type":"object". Example:',
    '{"type":"object","additionalProperties":false,"required":["plan"],"properties":{"plan":{"type":"string","minLength":1}}}',
    "For opening: expose at least one port with that bind_policy_json. For continue: bind.portId must be a listed peer port id and payload_json must satisfy its policy.",
    "Use max_bindings=1 and terminal=true unless you have a reason not to.",
    memoryBlock(ctx),
  ].join("\n");
}

function userPrompt(ctx: PolicyContext): string {
  const ports =
    ctx.peerPorts.length === 0
      ? "(none)"
      : ctx.peerPorts
          .map(
            (p: AvailablePeerPort) =>
              `- ${p.id} kind=${p.type} promise=${p.promise} policy=${JSON.stringify(p.bind_policy)}`,
          )
          .join("\n");
  return [
    ctx.opening
      ? "Opening turn: expose at least one port (or disconnect)."
      : "Continue turn: bind a peer port (required), or disconnect.",
    `Turns completed: ${ctx.turnsCompleted}/${ctx.maxTurns}`,
    "Peer ports you can bind:",
    ports,
  ].join("\n");
}

function parseJsonObject(raw: string | undefined, label: string): Record<string, unknown> | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return value as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${label} parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function normalizeBindPolicy(
  policy: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (policy === null) return null;
  if (policy.type === "object") return policy;
  return {
    type: "object",
    additionalProperties: false,
    ...policy,
    properties:
      policy.properties !== null &&
      typeof policy.properties === "object" &&
      !Array.isArray(policy.properties)
        ? policy.properties
        : {},
  };
}

function mapPort(raw: {
  kind: string;
  promise: string;
  bind_policy_json: string;
  terminal: boolean;
  max_bindings: number;
}) {
  const bind_policy = normalizeBindPolicy(
    parseJsonObject(raw.bind_policy_json, "bind_policy_json"),
  );
  return {
    kind: raw.kind,
    promise: raw.promise,
    ...(bind_policy !== null ? { bind_policy } : {}),
    terminal: raw.terminal,
    max_bindings: raw.max_bindings,
  };
}

function toEnvelopeRaw(ctx: PolicyContext, out: Record<string, unknown>): unknown {
  if (out.disconnect === true) return { disconnect: true };
  const exposeRaw = Array.isArray(out.expose) ? out.expose : [];
  const expose = exposeRaw.map((p) => mapPort(p as Parameters<typeof mapPort>[0]));
  if (ctx.opening) {
    return { expose };
  }
  const bindRaw = out.bind as { portId?: string; payload_json?: string } | undefined;
  if (bindRaw?.portId === undefined || bindRaw.portId.trim().length === 0) {
    throw new Error("continue turn requires bind.portId or disconnect=true");
  }
  const peer = ctx.peerPorts.find((p) => p.id === bindRaw.portId);
  const payload =
    peer?.bind_policy !== null && peer?.bind_policy !== undefined
      ? (parseJsonObject(bindRaw.payload_json, "payload_json") ?? {})
      : {};
  return {
    bind: { portId: bindRaw.portId, payload },
    ...(expose.length > 0 ? { expose } : {}),
  };
}

export function createAiPolicy(model: string): NegotiationPolicy {
  requireGatewayKey();
  const modelId = model.trim();
  if (modelId.length === 0) throw new Error("--model is required");

  return async (ctx) => {
    const result = await generateText({
      model: modelId,
      system: systemPrompt(ctx),
      messages: [{ role: "user", content: userPrompt(ctx) }],
      output: Output.object({
        name: "NbcTurn",
        description: "One NBC turn: expose ports, optionally bind one peer port, or disconnect.",
        schema: ctx.opening ? openingModelSchema : continueModelSchema,
      }),
      stopWhen: stepCountIs(MAX_MODEL_STEPS),
      abortSignal: AbortSignal.timeout(60_000),
    });
    if (result.output === undefined || result.output === null) {
      throw new Error("negotiation turn produced no structured output");
    }
    const turn = parseNegotiationTurnEnvelope(
      toEnvelopeRaw(ctx, result.output as Record<string, unknown>),
      { opening: ctx.opening, peerPorts: ctx.peerPorts },
    );
    return {
      turn,
      modelCalls: 1,
      tokens: usageFrom(result),
    };
  };
}

const reflectionSchema = z.object({
  generalNote: z
    .string()
    .describe("Short convention note reusable across peers, or empty string to skip."),
  peerNote: z
    .string()
    .describe("Short dyad-specific convention note for this peer, or empty string to skip."),
});

export function createAiReflect(model: string) {
  requireGatewayKey();
  const modelId = model.trim();
  return async (input: {
    actorDid: string;
    peerDid: string;
    purpose: string;
    outcome: string;
    protocolSignature: string;
    memory: { general: string; peer: string };
  }) => {
    const result = await generateText({
      model: modelId,
      system: [
        "You maintain scoped Markdown negotiation memory.",
        "After an episode, optionally append one short general note and one peer-specific note.",
        "Keep each note under 280 characters. Use empty strings to skip.",
        "Do not invent secrets. Prefer protocol shape hints (kinds, promises, bind keys).",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Actor: ${input.actorDid}`,
            `Peer: ${input.peerDid}`,
            `Purpose: ${input.purpose}`,
            `Outcome: ${input.outcome}`,
            `Protocol signature: ${input.protocolSignature}`,
            "Existing general.md:",
            input.memory.general.trim() || "(empty)",
            "Existing peer.md:",
            input.memory.peer.trim() || "(empty)",
          ].join("\n"),
        },
      ],
      output: Output.object({
        name: "MemoryReflection",
        description: "Optional memory append notes",
        schema: reflectionSchema,
      }),
      stopWhen: stepCountIs(4),
      abortSignal: AbortSignal.timeout(60_000),
    });
    const out = result.output ?? { generalNote: "", peerNote: "" };
    return {
      generalNote: out.generalNote.slice(0, 280),
      peerNote: out.peerNote.slice(0, 280),
      modelCalls: 1,
      tokens: usageFrom(result),
    };
  };
}

/** Deterministic two-turn bind for tests. */
export function createScriptedBindPolicy(): NegotiationPolicy {
  return async (ctx) => {
    if (ctx.opening) {
      return {
        turn: {
          expose: [
            {
              kind: "coord.slot",
              promise: "orchestration.v1",
              terminal: true,
              bind_policy: {
                type: "object",
                additionalProperties: false,
                required: ["plan"],
                properties: {
                  plan: { type: "string", minLength: 1 },
                },
              },
            },
          ],
        },
      };
    }
    const port = ctx.peerPorts[0];
    if (port === undefined) {
      return { turn: { disconnect: true } };
    }
    return {
      turn: {
        bind: { portId: port.id, payload: { plan: "repeat" } },
      },
    };
  };
}
