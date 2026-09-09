import { describe, expect, test } from "bun:test";
import { continueTurnSchemaForPorts } from "@khoralabs/obp-nbc";

import {
  adaptPayloadSchemaForOpenAi,
  adaptPropSchemaForOpenAi,
  authoredPolicyToJson,
  type ContinueStep1Output,
  continueStep1JsonSchema,
  decodeOpeningTurn,
  type ExtendStepOutput,
  emptyExtend,
  jsonSchemaObjectToZod,
  jsonSchemaPropToZod,
  makeOpenAiStrictObjectSchema,
  mergeContinueTurn,
  schemaContainsOneOf,
  toContinueStep1Adapter,
} from "./openai-turn-adapter.ts";

const priceDeliveryPolicy = {
  type: "object",
  additionalProperties: false,
  required: ["Price", "Delivery", "Payment", "Returns"],
  properties: {
    Price: {
      enum: ["$4.37", "$4.12", "$3.98", "$3.71", "$3.47"],
    },
    Delivery: {
      enum: ["60 days", "45 days", "30 days", "20 days"],
    },
    Payment: {
      enum: ["Upon delivery", "30 days after delivery", "60 days after delivery"],
    },
    Returns: {
      enum: ["Full price", "5% spoilage allowed", "10% spoilage allowed"],
    },
  },
} as const;

const completeContract = {
  Price: "$3.98",
  Delivery: "45 days",
  Payment: "Upon delivery",
  Returns: "5% spoilage allowed",
};

describe("openai-turn-adapter", () => {
  test("jsonSchemaPropToZod preserves string-literal enums (not widened to string)", () => {
    const zod = jsonSchemaPropToZod({
      enum: ["$4.37", "$4.12", "$3.98"],
    });
    expect(zod.safeParse("$4.12").success).toBe(true);
    expect(zod.safeParse("$9.99").success).toBe(false);
    expect(zod.safeParse(12).success).toBe(false);
  });

  test("jsonSchemaPropToZod accepts single-item non-string enums as literals", () => {
    const zod = jsonSchemaPropToZod({ enum: [3.98] });
    expect(zod.safeParse(3.98).success).toBe(true);
    expect(zod.safeParse(4.12).success).toBe(false);
  });

  test("continue step1 uses nested anyOf (never oneOf) with per-port payload enums", () => {
    const ports = [
      { id: "id-2", bind_policy: priceDeliveryPolicy },
      { id: "id-4", bind_policy: priceDeliveryPolicy },
    ];
    const canonical = continueTurnSchemaForPorts(ports)["~standard"].jsonSchema.input({
      target: "draft-2020-12",
    }) as Record<string, unknown>;
    const bind = (canonical.properties as Record<string, unknown>).bind as {
      oneOf: unknown[];
    };
    expect(Array.isArray(bind.oneOf)).toBe(true);

    const step1 = continueStep1JsonSchema(ports);
    expect(schemaContainsOneOf(step1)).toBe(false);
    const choice = (step1.properties as { choice: { anyOf: unknown[] } }).choice;
    expect(Array.isArray(choice.anyOf)).toBe(true);
    expect(choice.anyOf.length).toBe(3); // leave + 2 binds
    const dumped = JSON.stringify(step1);
    expect(dumped).toContain("$3.98");
    expect(dumped).toContain("id-2");
    expect(dumped).toContain("id-4");
    expect(dumped).not.toMatch(/"Price":\s*\{\s*"type":\s*"string"\s*\}/);
  });

  test("step1 omits OpenAI-incompatible peer bind branches but keeps leave", () => {
    const ports: Array<{ id: string; bind_policy: Record<string, unknown> }> = [
      {
        id: "bad-const-enum",
        bind_policy: {
          type: "object",
          additionalProperties: false,
          required: ["Price"],
          properties: {
            Price: { const: "", enum: ["$4.37", "$3.98"] },
          },
        },
      },
      {
        id: "bad-required-missing",
        bind_policy: {
          type: "object",
          additionalProperties: false,
          required: ["Price"],
          properties: {},
        },
      },
      { id: "good", bind_policy: { ...priceDeliveryPolicy } },
    ];
    const step1 = continueStep1JsonSchema(ports as never);
    expect(schemaContainsOneOf(step1)).toBe(false);
    const choice = (step1.properties as { choice: { anyOf: unknown[] } }).choice;
    const dumped = JSON.stringify(choice.anyOf);
    expect(dumped).toContain('"const":"leave"');
    expect(dumped).toContain("good");
    expect(dumped).not.toContain("bad-const-enum");
    expect(dumped).not.toContain("bad-required-missing");
    expect(choice.anyOf.length).toBe(2); // leave + good
  });

  test("adaptPropSchemaForOpenAi drops conflicting const/enum", () => {
    expect(
      adaptPropSchemaForOpenAi({ const: "$3.98},{", enum: ["$3.98"], type: "string" }),
    ).toBeNull();
    expect(adaptPropSchemaForOpenAi({ const: "", enum: ["$3.98"] })).toBeNull();
    expect(adaptPropSchemaForOpenAi({ const: "$3.98", enum: ["$3.98", "$4.12"] })).toEqual({
      type: "string",
      const: "$3.98",
    });
  });

  test("adaptPayloadSchemaForOpenAi rejects required keys missing from properties", () => {
    expect(
      adaptPayloadSchemaForOpenAi({
        type: "object",
        required: ["Price"],
        properties: {},
      }),
    ).toBeNull();
  });

  test("step1 adapter validate accepts leave and single bind", async () => {
    const ports = [{ id: "id-2", bind_policy: priceDeliveryPolicy }];
    const adapter = toContinueStep1Adapter(ports);
    const leave = await adapter.schema.validate?.({ choice: { action: "leave" } });
    expect(leave?.success).toBe(true);

    const bind = await adapter.schema.validate?.({
      choice: {
        action: "bind",
        portId: "id-2",
        payload: completeContract,
      },
    });
    expect(bind?.success).toBe(true);

    const bad = await adapter.schema.validate?.({
      choice: { action: "bind", portId: "id-2", payload: null },
    });
    expect(bad?.success).toBe(false);
  });

  test("empty payload fails merge when policy requires fields", () => {
    const ports = [{ id: "id-2", bind_policy: priceDeliveryPolicy }];
    const step1: ContinueStep1Output = {
      choice: { action: "bind", portId: "id-2", payload: {} },
    };
    expect(() => mergeContinueTurn(step1, null, ports)).toThrow(/bind_payload|required|Price/i);
  });

  test("valid bind payload round-trips through canonical continue schema", () => {
    const ports = [{ id: "id-2", bind_policy: priceDeliveryPolicy }];
    const turn = mergeContinueTurn(
      {
        choice: { action: "bind", portId: "id-2", payload: { ...completeContract } },
      },
      null,
      ports,
    );
    expect(turn).toEqual({
      bind: { portId: "id-2", payload: completeContract },
    });
  });

  test("leave skips extend and returns disconnect", () => {
    const ports = [{ id: "id-2", bind_policy: priceDeliveryPolicy }];
    expect(
      mergeContinueTurn({ choice: { action: "leave" } }, { extend: emptyExtend() }, ports),
    ).toEqual({ disconnect: true });
  });

  test("merge continue bind + extend", () => {
    const ports = [{ id: "id-2", bind_policy: priceDeliveryPolicy }];
    const step2: ExtendStepOutput = {
      extend: {
        ...emptyExtend(),
        offer0: {
          kind: "coord.slot",
          promise: "next",
          terminal: false,
          max_bindings: 1,
          bind_policy: null,
        },
      },
    };
    const turn = mergeContinueTurn(
      {
        choice: { action: "bind", portId: "id-2", payload: { ...completeContract } },
      },
      step2,
      ports,
    );
    expect("bind" in turn && turn.bind.portId).toBe("id-2");
    expect("expose" in turn && turn.expose?.[0]?.kind).toBe("coord.slot");
  });

  test("authoredPolicyToJson derives required and mutually exclusive constraints", () => {
    const doc = authoredPolicyToJson({
      type: "object",
      additionalProperties: false,
      properties: [
        {
          name: "Price",
          required: true,
          constraint: { mode: "const", value: "$3.98" },
        },
        {
          name: "Delivery",
          required: false,
          constraint: { mode: "enum", values: ["30 days", "45 days"] },
        },
        {
          name: "Note",
          required: true,
          constraint: { mode: "free", type: "string", minLength: 1 },
        },
        // duplicate name: first wins
        {
          name: "Price",
          required: false,
          constraint: { mode: "enum", values: ["$9.99"] },
        },
      ],
    });
    expect(doc).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["Price", "Note"],
      properties: {
        Price: { type: "string", const: "$3.98" },
        Delivery: { type: "string", enum: ["30 days", "45 days"] },
        Note: { type: "string", minLength: 1 },
      },
    });
    expect(JSON.stringify(doc)).not.toContain("$9.99");
  });

  test("opening requires extend offer and compiles authored policy", () => {
    expect(() => decodeOpeningTurn({ leave: false, extend: emptyExtend() })).toThrow(
      /at least one extend/,
    );
    expect(decodeOpeningTurn({ leave: true, extend: emptyExtend() })).toEqual({
      disconnect: true,
    });
    const turn = decodeOpeningTurn({
      leave: false,
      extend: {
        ...emptyExtend(),
        offer0: {
          kind: "contract.complete",
          promise: "itex.v1",
          terminal: true,
          max_bindings: 1,
          bind_policy: {
            type: "object",
            additionalProperties: false,
            properties: [
              {
                name: "Price",
                required: true,
                constraint: { mode: "const", value: "$3.98" },
              },
            ],
          },
        },
      },
    });
    expect("expose" in turn && !("bind" in turn)).toBe(true);
    if ("expose" in turn && turn.expose !== undefined) {
      expect(turn.expose[0]?.kind).toBe("contract.complete");
      expect(turn.expose[0]?.bind_policy).toMatchObject({
        type: "object",
        required: ["Price"],
        properties: { Price: { type: "string", const: "$3.98" } },
      });
    }
  });

  test("jsonSchemaObjectToZod rejects missing required keys", () => {
    const zod = jsonSchemaObjectToZod(priceDeliveryPolicy);
    expect(zod.safeParse(completeContract).success).toBe(true);
    expect(zod.safeParse({ Price: "$3.98" }).success).toBe(false);
  });

  test("makeOpenAiStrictObjectSchema lists all properties as required", () => {
    const strict = makeOpenAiStrictObjectSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    });
    expect(strict.required).toEqual(["a", "b"]);
    expect((strict.properties as Record<string, unknown>).b).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    });
  });
});
