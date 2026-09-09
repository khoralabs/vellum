/**
 * Lab-local OpenAI adapter over canonical OBP host turn schemas.
 *
 * Canonical `continueTurnSchemaForPorts` uses `oneOf` on bind (OpenAI-hostile).
 * Continue turns use two structured-output steps merged into one NBC ContinueTurn:
 *   1. nested `anyOf` leave | bind(portId.const + payload schema)
 *   2. optional extend.offer0..3
 *
 * Authored bind_policy properties use a discriminated constraint (free | enum | const)
 * so required keys cannot drift from declared properties, and conflicting const/enum
 * cannot be co-authored. Peer policies that remain OpenAI-incompatible are omitted
 * from step-1 bind branches (leave always remains).
 *
 * Follow-up: promote into @khoralabs/obp-nbc (or companion) as a first-class helper.
 */

import type { JsonDocument } from "@khoralabs/obp-core";
import {
  continueTurnSchemaForPorts,
  type HostTurnBody,
  type OpeningPort,
  openingTurnSchema,
  validateBindPolicyAtExpose,
} from "@khoralabs/obp-nbc";
import { parseNegotiationTurnEnvelope } from "@khoralabs/obp-nbc/host";
import { jsonSchema, type Schema } from "ai";
import { z } from "zod";

import type { LabPortDef, LabTurn } from "./types.ts";

const MAX_EXTEND_SLOTS = 4;

export type PeerPortForSchema = {
  id: string;
  bind_policy?: JsonDocument | null;
};

export type ScalarValue = string | number | boolean;

export type BindPolicyConstraintAuthor =
  | { mode: "free"; type: "string" | "number" | "boolean" | "integer"; minLength: number | null }
  | { mode: "enum"; values: ScalarValue[] }
  | { mode: "const"; value: ScalarValue };

export type BindPolicyPropertyAuthor = {
  name: string;
  required: boolean;
  constraint: BindPolicyConstraintAuthor;
};

export type BindPolicyAuthorOutput = {
  type: "object";
  additionalProperties: boolean | null;
  /** OpenAI-safe: array instead of record (avoids propertyNames). */
  properties: BindPolicyPropertyAuthor[];
};

export type ExtendPortOutput = {
  kind: string;
  promise: string;
  terminal: boolean;
  max_bindings: number;
  bind_policy: BindPolicyAuthorOutput | null;
};

export type ContinueStep1Choice =
  | { action: "leave" }
  | { action: "bind"; portId: string; payload: Record<string, unknown> };

export type ContinueStep1Output = {
  choice: ContinueStep1Choice;
};

export type ExtendStepOutput = {
  extend: Record<string, ExtendPortOutput | null>;
};

export type OpeningTurnOutput = {
  leave: boolean;
  extend: Record<string, ExtendPortOutput | null>;
};

export type ContinueStep1Adapter = {
  schema: Schema<ContinueStep1Output>;
  jsonSchema: Record<string, unknown>;
  peerPorts: readonly PeerPortForSchema[];
};

export type ExtendStepAdapter = {
  schema: Schema<ExtendStepOutput>;
  zodSchema: z.ZodType<ExtendStepOutput>;
};

export type OpeningTurnAdapter = {
  schema: Schema<OpeningTurnOutput>;
  zodSchema: z.ZodType<OpeningTurnOutput>;
};

const scalarZod = z.union([z.string(), z.number(), z.boolean()]);

const constraintAuthorZod: z.ZodType<BindPolicyConstraintAuthor> = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("free"),
    type: z.enum(["string", "number", "boolean", "integer"]),
    minLength: z.number().int().nullable(),
  }),
  z.object({
    mode: z.literal("enum"),
    values: z.array(scalarZod).min(1),
  }),
  z.object({
    mode: z.literal("const"),
    value: scalarZod,
  }),
]);

const propertyAuthorZod: z.ZodType<BindPolicyPropertyAuthor> = z.object({
  name: z.string().min(1),
  required: z.boolean(),
  constraint: constraintAuthorZod,
});

const bindPolicyAuthorZod: z.ZodType<BindPolicyAuthorOutput> = z.object({
  type: z.literal("object"),
  additionalProperties: z.boolean().nullable(),
  properties: z.array(propertyAuthorZod),
});

const extendPortZod: z.ZodType<ExtendPortOutput> = z.object({
  kind: z.string().min(1),
  promise: z.string().min(1),
  terminal: z.boolean(),
  max_bindings: z.number().int().min(1),
  bind_policy: bindPolicyAuthorZod.nullable(),
});

function buildExtendShape(): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (let i = 0; i < MAX_EXTEND_SLOTS; i++) {
    shape[`offer${i}`] = extendPortZod.nullable();
  }
  return shape;
}

const extendStepZod = z.object({
  extend: z.object(buildExtendShape()).strict(),
}) as z.ZodType<ExtendStepOutput>;

const openingTurnZod = z.object({
  leave: z.boolean(),
  extend: z.object(buildExtendShape()).strict(),
}) as z.ZodType<OpeningTurnOutput>;

/** Drop nulls so AJV/canonical schemas see omitted optional fields. */
export function stripNullFields(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(stripNullFields);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNullFields(v);
    }
    return out;
  }
  return value;
}

/** Convert a JSON Schema property node to Zod, preserving string-literal enums/consts. */
export function jsonSchemaPropToZod(prop: unknown): z.ZodTypeAny {
  if (prop === null || typeof prop !== "object" || Array.isArray(prop)) {
    return z.unknown();
  }
  const p = prop as Record<string, unknown>;
  if ("const" in p) {
    const c = p.const;
    if (typeof c === "string" || typeof c === "number" || typeof c === "boolean") {
      return z.literal(c);
    }
  }
  if (Array.isArray(p.enum) && p.enum.length > 0) {
    const allStrings = p.enum.every((x) => typeof x === "string");
    if (allStrings) {
      const vals = p.enum as string[];
      const only = vals[0];
      if (vals.length === 1 && only !== undefined) return z.literal(only);
      return z.enum(vals as [string, ...string[]]);
    }
    const literals = p.enum.filter(
      (x): x is string | number | boolean =>
        typeof x === "string" || typeof x === "number" || typeof x === "boolean",
    );
    if (literals.length === p.enum.length && literals.length >= 1) {
      const only = literals[0];
      if (literals.length === 1 && only !== undefined) return z.literal(only);
      return z.union(
        literals.map((x) => z.literal(x)) as [
          z.ZodLiteral<string | number | boolean>,
          z.ZodLiteral<string | number | boolean>,
          ...z.ZodLiteral<string | number | boolean>[],
        ],
      );
    }
  }
  if (p.type === "string") {
    let s = z.string();
    if (typeof p.minLength === "number") s = s.min(p.minLength);
    return s;
  }
  if (p.type === "boolean") return z.boolean();
  if (p.type === "number" || p.type === "integer") return z.number();
  if (p.type === "object" || p.properties !== undefined) {
    return jsonSchemaObjectToZod(p);
  }
  return z.unknown();
}

/** Convert a JSON Schema object (e.g. bind_policy payload) to a Zod object. */
export function jsonSchemaObjectToZod(schema: unknown): z.ZodObject<z.ZodRawShape> {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return z.object({}).strict();
  }
  const s = schema as Record<string, unknown>;
  const props =
    s.properties !== null && typeof s.properties === "object" && !Array.isArray(s.properties)
      ? (s.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === "string") : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(props)) {
    let field = jsonSchemaPropToZod(prop);
    if (!required.has(key)) field = field.nullable();
    shape[key] = field;
  }
  return z.object(shape).strict();
}

function canonicalContinueJsonSchema(
  peerPorts: readonly PeerPortForSchema[],
): Record<string, unknown> {
  return continueTurnSchemaForPorts(peerPorts)["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  }) as Record<string, unknown>;
}

function extractBindOneOfBranches(
  continueJson: Record<string, unknown>,
): Array<{ portId: string; payloadSchema: unknown }> {
  const props = continueJson.properties as Record<string, unknown> | undefined;
  const bind = props?.bind as Record<string, unknown> | undefined;
  const oneOf = bind?.oneOf;
  if (!Array.isArray(oneOf)) return [];
  const out: Array<{ portId: string; payloadSchema: unknown }> = [];
  for (const branch of oneOf) {
    if (branch === null || typeof branch !== "object" || Array.isArray(branch)) continue;
    const b = branch as Record<string, unknown>;
    const bProps = b.properties as Record<string, unknown> | undefined;
    const portIdNode = bProps?.portId as Record<string, unknown> | undefined;
    const portId = typeof portIdNode?.const === "string" ? portIdNode.const : "";
    out.push({
      portId,
      payloadSchema: bProps?.payload ?? {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    });
  }
  return out;
}

function isScalar(v: unknown): v is ScalarValue {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * Adapt a property schema node for OpenAI structured outputs.
 * Returns null when the node is unsatisfiable or uses unsupported keywords.
 */
export function adaptPropSchemaForOpenAi(prop: unknown): Record<string, unknown> | null {
  if (prop === null || typeof prop !== "object" || Array.isArray(prop)) return null;
  const p = prop as Record<string, unknown>;
  if ("oneOf" in p || "allOf" in p || "not" in p || "$ref" in p) return null;
  if (Array.isArray(p.anyOf)) {
    const adapted: Record<string, unknown>[] = [];
    for (const branch of p.anyOf) {
      const a = adaptPropSchemaForOpenAi(branch);
      if (a === null) return null;
      adapted.push(a);
    }
    return { anyOf: adapted };
  }

  if (p.type === "object" || p.properties !== undefined) {
    return adaptPayloadSchemaForOpenAi(p);
  }

  const hasConst = "const" in p;
  const enumVals = Array.isArray(p.enum) ? (p.enum as unknown[]) : null;
  const hasEnum = enumVals !== null && enumVals.length > 0;
  const constVal = p.const;

  if (hasConst) {
    if (!isScalar(constVal)) return null;
    if (typeof constVal === "string" && constVal.length === 0) return null;
    if (hasEnum) {
      if (!enumVals.every(isScalar)) return null;
      if (!enumVals.includes(constVal)) return null;
    }
    const out: Record<string, unknown> = { const: constVal };
    if (
      p.type === "string" ||
      p.type === "number" ||
      p.type === "boolean" ||
      p.type === "integer"
    ) {
      out.type = p.type;
    } else if (typeof constVal === "string") out.type = "string";
    else if (typeof constVal === "number") out.type = "number";
    else out.type = "boolean";
    return out;
  }

  if (hasEnum) {
    if (!enumVals.every(isScalar)) return null;
    const values = enumVals as ScalarValue[];
    if (values.length === 0) return null;
    const out: Record<string, unknown> = { enum: values };
    if (values.every((v) => typeof v === "string")) out.type = "string";
    else if (values.every((v) => typeof v === "number")) out.type = "number";
    else if (values.every((v) => typeof v === "boolean")) out.type = "boolean";
    return out;
  }

  if (p.type === "string") {
    const out: Record<string, unknown> = { type: "string" };
    if (typeof p.minLength === "number") out.minLength = p.minLength;
    return out;
  }
  if (p.type === "boolean") return { type: "boolean" };
  if (p.type === "number" || p.type === "integer") return { type: p.type };
  return null;
}

/**
 * Adapt a payload object schema for OpenAI. Returns null if incompatible.
 * OpenAI strict: all object keys required; former optionals become anyOf[T, null].
 */
export function adaptPayloadSchemaForOpenAi(schema: unknown): Record<string, unknown> | null {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", additionalProperties: false, properties: {}, required: [] };
  }
  const s = schema as Record<string, unknown>;
  if ("oneOf" in s || "allOf" in s || "not" in s || "$ref" in s) return null;
  if (Array.isArray(s.anyOf)) {
    const adapted: Record<string, unknown>[] = [];
    for (const branch of s.anyOf) {
      const a = adaptPayloadSchemaForOpenAi(branch);
      if (a === null) return null;
      adapted.push(a);
    }
    return { anyOf: adapted };
  }

  const propsIn =
    s.properties !== null && typeof s.properties === "object" && !Array.isArray(s.properties)
      ? (s.properties as Record<string, unknown>)
      : {};
  const requiredIn = new Set(
    Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === "string") : [],
  );
  // Required keys missing from properties → OpenAI/AJV strict failure.
  for (const key of requiredIn) {
    if (!(key in propsIn)) return null;
  }

  const properties: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(propsIn)) {
    const node = adaptPropSchemaForOpenAi(prop);
    if (node === null) return null;
    if (!requiredIn.has(key)) {
      properties[key] = { anyOf: [node, { type: "null" }] };
    } else {
      properties[key] = node;
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

/** @deprecated Prefer adaptPayloadSchemaForOpenAi; kept for tests of required-key promotion. */
export function makeOpenAiStrictObjectSchema(schema: unknown): Record<string, unknown> {
  return (
    adaptPayloadSchemaForOpenAi(schema) ?? {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    }
  );
}

function leaveBranch(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: { type: "string", const: "leave" },
    },
  };
}

function bindBranch(
  portId: string,
  payloadSchema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action", "portId", "payload"],
    properties: {
      action: { type: "string", const: "bind" },
      portId: { type: "string", const: portId },
      payload: payloadSchema,
    },
  };
}

/** Hand-authored continue step-1 JSON Schema (nested anyOf; never oneOf). */
export function continueStep1JsonSchema(
  peerPorts: readonly PeerPortForSchema[],
): Record<string, unknown> {
  const continueJson = canonicalContinueJsonSchema(peerPorts);
  const branches = extractBindOneOfBranches(continueJson);
  const anyOf: Record<string, unknown>[] = [leaveBranch()];
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    if (branch === undefined) continue;
    const portId = branch.portId.length > 0 ? branch.portId : (peerPorts[i]?.id ?? `unknown-${i}`);
    const adapted = adaptPayloadSchemaForOpenAi(branch.payloadSchema);
    if (adapted === null) continue; // isolate incompatible peer policy
    anyOf.push(bindBranch(portId, adapted));
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["choice"],
    properties: {
      choice: { anyOf },
    },
  };
}

function parseContinueStep1Choice(value: unknown): ContinueStep1Choice {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("continue step1: choice must be an object");
  }
  const c = value as Record<string, unknown>;
  if (c.action === "leave") {
    return { action: "leave" };
  }
  if (c.action === "bind") {
    if (typeof c.portId !== "string" || c.portId.length === 0) {
      throw new Error("continue step1: bind requires portId");
    }
    if (c.payload === null || typeof c.payload !== "object" || Array.isArray(c.payload)) {
      throw new Error("continue step1: bind requires object payload");
    }
    return {
      action: "bind",
      portId: c.portId,
      payload: c.payload as Record<string, unknown>,
    };
  }
  throw new Error("continue step1: choice.action must be leave or bind");
}

export function toContinueStep1Adapter(
  peerPorts: readonly PeerPortForSchema[],
): ContinueStep1Adapter {
  const schemaDoc = continueStep1JsonSchema(peerPorts);
  return {
    jsonSchema: schemaDoc,
    peerPorts,
    schema: jsonSchema<ContinueStep1Output>(schemaDoc as never, {
      validate: (value) => {
        try {
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            return { success: false, error: new Error("expected object") };
          }
          const choice = parseContinueStep1Choice((value as Record<string, unknown>).choice);
          return { success: true, value: { choice } };
        } catch (e) {
          return {
            success: false,
            error: e instanceof Error ? e : new Error(String(e)),
          };
        }
      },
    }),
  };
}

const CONSTRAINT_AUTHOR_JSON: Record<string, unknown> = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "type", "minLength"],
      properties: {
        mode: { type: "string", const: "free" },
        type: { type: "string", enum: ["string", "number", "boolean", "integer"] },
        minLength: { anyOf: [{ type: "integer" }, { type: "null" }] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "values"],
      properties: {
        mode: { type: "string", const: "enum" },
        values: {
          type: "array",
          minItems: 1,
          items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "value"],
      properties: {
        mode: { type: "string", const: "const" },
        value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
      },
    },
  ],
};

const BIND_POLICY_AUTHOR_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["type", "additionalProperties", "properties"],
  properties: {
    type: { type: "string", const: "object" },
    additionalProperties: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    properties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "required", "constraint"],
        properties: {
          name: { type: "string", minLength: 1 },
          required: { type: "boolean" },
          constraint: CONSTRAINT_AUTHOR_JSON,
        },
      },
    },
  },
};

const EXTEND_PORT_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "promise", "terminal", "max_bindings", "bind_policy"],
  properties: {
    kind: { type: "string", minLength: 1 },
    promise: { type: "string", minLength: 1 },
    terminal: { type: "boolean" },
    max_bindings: { type: "integer", minimum: 1 },
    bind_policy: { anyOf: [BIND_POLICY_AUTHOR_JSON, { type: "null" }] },
  },
};

const EXTEND_SLOTS_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: Array.from({ length: MAX_EXTEND_SLOTS }, (_, i) => `offer${i}`),
  properties: Object.fromEntries(
    Array.from({ length: MAX_EXTEND_SLOTS }, (_, i) => [
      `offer${i}`,
      { anyOf: [EXTEND_PORT_JSON, { type: "null" }] },
    ]),
  ),
};

const EXTEND_STEP_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["extend"],
  properties: { extend: EXTEND_SLOTS_JSON },
};

const OPENING_TURN_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["leave", "extend"],
  properties: {
    leave: { type: "boolean" },
    extend: EXTEND_SLOTS_JSON,
  },
};

export function toExtendStepAdapter(): ExtendStepAdapter {
  return {
    zodSchema: extendStepZod,
    schema: jsonSchema<ExtendStepOutput>(EXTEND_STEP_JSON as never, {
      validate: (value) => {
        const parsed = extendStepZod.safeParse(value);
        if (!parsed.success) {
          return { success: false, error: parsed.error };
        }
        return { success: true, value: parsed.data };
      },
    }),
  };
}

export function toOpeningTurnAdapter(): OpeningTurnAdapter {
  return {
    zodSchema: openingTurnZod,
    schema: jsonSchema<OpeningTurnOutput>(OPENING_TURN_JSON as never, {
      validate: (value) => {
        const parsed = openingTurnZod.safeParse(value);
        if (!parsed.success) {
          return { success: false, error: parsed.error };
        }
        return { success: true, value: parsed.data };
      },
    }),
  };
}

function constraintToJsonSchema(constraint: BindPolicyConstraintAuthor): Record<string, unknown> {
  if (constraint.mode === "free") {
    const node: Record<string, unknown> = { type: constraint.type };
    if (constraint.type === "string" && constraint.minLength !== null) {
      node.minLength = constraint.minLength;
    }
    return node;
  }
  if (constraint.mode === "enum") {
    const values = constraint.values;
    const node: Record<string, unknown> = { enum: values };
    if (values.every((v) => typeof v === "string")) node.type = "string";
    else if (values.every((v) => typeof v === "number")) node.type = "number";
    else if (values.every((v) => typeof v === "boolean")) node.type = "boolean";
    return node;
  }
  const node: Record<string, unknown> = { const: constraint.value };
  if (typeof constraint.value === "string") node.type = "string";
  else if (typeof constraint.value === "number") node.type = "number";
  else node.type = "boolean";
  return node;
}

/** Convert authored policy → canonical JSON Schema; compile-check via OBP. */
export function authoredPolicyToJson(policy: BindPolicyAuthorOutput | null): JsonDocument | null {
  if (policy === null) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const seen = new Set<string>();

  for (const prop of policy.properties) {
    const name = prop.name.trim();
    if (name.length === 0) continue;
    if (seen.has(name)) continue; // first declaration wins
    seen.add(name);
    properties[name] = constraintToJsonSchema(prop.constraint);
    if (prop.required) required.push(name);
  }

  const doc = {
    type: "object",
    additionalProperties:
      policy.additionalProperties === null ? false : policy.additionalProperties,
    ...(required.length > 0 ? { required } : {}),
    properties,
  } as JsonDocument;

  validateBindPolicyAtExpose(doc);
  return doc;
}

function extendToOpeningPorts(extend: Record<string, ExtendPortOutput | null>): OpeningPort[] {
  const ports: OpeningPort[] = [];
  for (let i = 0; i < MAX_EXTEND_SLOTS; i++) {
    const slot = extend[`offer${i}`];
    if (slot === null || slot === undefined) continue;
    const bind_policy = authoredPolicyToJson(slot.bind_policy);
    ports.push({
      kind: slot.kind,
      promise: slot.promise,
      terminal: slot.terminal,
      max_bindings: slot.max_bindings,
      ...(bind_policy !== null ? { bind_policy } : {}),
    });
  }
  return ports;
}

function hostBodyToLabTurn(body: HostTurnBody): LabTurn {
  if ("disconnect" in body && body.disconnect === true) {
    return { disconnect: true };
  }
  if ("bind" in body) {
    const expose = (body.expose ?? []).map(
      (p: OpeningPort): LabPortDef => ({
        kind: p.kind,
        promise: p.promise,
        ...(p.bind_policy !== undefined && p.bind_policy !== null
          ? { bind_policy: p.bind_policy }
          : {}),
        ...(p.terminal !== undefined ? { terminal: p.terminal } : {}),
        ...(p.max_bindings !== undefined ? { max_bindings: p.max_bindings } : {}),
        ...(p.ref !== undefined ? { ref: p.ref } : {}),
        ...(p.id !== undefined ? { id: p.id } : {}),
      }),
    );
    return {
      bind: {
        portId: body.bind.portId,
        payload: body.bind.payload ?? {},
      },
      ...(expose.length > 0 ? { expose } : {}),
    };
  }
  if (!("expose" in body)) {
    throw new Error("expected opening turn with expose");
  }
  return {
    expose: body.expose.map(
      (p: OpeningPort): LabPortDef => ({
        kind: p.kind,
        promise: p.promise,
        ...(p.bind_policy !== undefined && p.bind_policy !== null
          ? { bind_policy: p.bind_policy }
          : {}),
        ...(p.terminal !== undefined ? { terminal: p.terminal } : {}),
        ...(p.max_bindings !== undefined ? { max_bindings: p.max_bindings } : {}),
        ...(p.ref !== undefined ? { ref: p.ref } : {}),
        ...(p.id !== undefined ? { id: p.id } : {}),
      }),
    ),
  };
}

export function decodeOpeningTurn(output: OpeningTurnOutput): LabTurn {
  if (output.leave === true) {
    return { disconnect: true };
  }
  const expose = extendToOpeningPorts(output.extend);
  if (expose.length < 1) {
    throw new Error("opening turn requires at least one extend offer (or leave=true)");
  }
  const canonical = { expose };
  const validated = openingTurnSchema["~standard"].validate(canonical);
  if (validated instanceof Promise) {
    throw new Error("opening schema must be sync");
  }
  if (validated.issues) {
    throw new Error(validated.issues.map((i) => i.message).join("; "));
  }
  parseNegotiationTurnEnvelope(validated.value, {
    opening: true,
    peerPorts: [],
  });
  return hostBodyToLabTurn(validated.value);
}

/** Merge continue step1 (leave|bind) + optional step2 extend → LabTurn. */
export function mergeContinueTurn(
  step1: ContinueStep1Output,
  step2: ExtendStepOutput | null,
  peerPorts: readonly PeerPortForSchema[],
): LabTurn {
  if (step1.choice.action === "leave") {
    return { disconnect: true };
  }

  const expose = step2 !== null ? extendToOpeningPorts(step2.extend) : [];
  const payload = stripNullFields(step1.choice.payload) as Record<string, unknown>;
  const canonical: Record<string, unknown> = {
    bind: { portId: step1.choice.portId, payload },
    ...(expose.length > 0 ? { expose } : {}),
  };

  const continueSchema = continueTurnSchemaForPorts(peerPorts);
  const validated = continueSchema["~standard"].validate(canonical);
  if (validated instanceof Promise) {
    throw new Error("continue schema must be sync");
  }
  if (validated.issues) {
    throw new Error(validated.issues.map((i) => i.message).join("; "));
  }

  parseNegotiationTurnEnvelope(validated.value, {
    opening: false,
    peerPorts: peerPorts.map((p) => ({
      id: p.id,
      type: "port",
      promise: "",
      partyId: "",
      bind_policy: (p.bind_policy ?? null) as Record<string, unknown> | null,
    })),
  });

  return hostBodyToLabTurn(validated.value);
}

/** True if any nested schema node uses `oneOf` (OpenAI-hostile). */
export function schemaContainsOneOf(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(schemaContainsOneOf);
  const obj = node as Record<string, unknown>;
  if ("oneOf" in obj) return true;
  return Object.values(obj).some(schemaContainsOneOf);
}

export function emptyExtend(): Record<string, ExtendPortOutput | null> {
  return {
    offer0: null,
    offer1: null,
    offer2: null,
    offer3: null,
  };
}
