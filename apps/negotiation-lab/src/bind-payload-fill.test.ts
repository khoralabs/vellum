import { describe, expect, test } from "bun:test";

import { fillPayloadFromBindPolicy } from "./bind-payload-fill.ts";

describe("bind payload fill", () => {
  test("fills missing const and single-enum fields from policy", () => {
    const filled = fillPayloadFromBindPolicy(
      {
        type: "object",
        required: ["Price", "Delivery"],
        properties: {
          Price: { type: "string", const: "$3.98" },
          Delivery: { type: "string", enum: ["45 days"] },
          Payment: { type: "string" },
        },
      },
      { Payment: "Upon delivery" },
    );
    expect(filled).toEqual({
      Payment: "Upon delivery",
      Price: "$3.98",
      Delivery: "45 days",
    });
  });

  test("does not overwrite existing payload values", () => {
    const filled = fillPayloadFromBindPolicy(
      {
        type: "object",
        properties: {
          Price: { type: "string", const: "$3.98" },
          Delivery: { type: "string", enum: ["45 days"] },
        },
      },
      { Price: "$4.12", Delivery: "30 days" },
    );
    expect(filled).toEqual({
      Price: "$4.12",
      Delivery: "30 days",
    });
  });

  test("ignores multi-value enums", () => {
    const filled = fillPayloadFromBindPolicy(
      {
        type: "object",
        properties: {
          Delivery: { type: "string", enum: ["45 days", "30 days"] },
          Price: { type: "string", const: "$3.98" },
        },
      },
      {},
    );
    expect(filled).toEqual({ Price: "$3.98" });
  });

  test("returns safe objects for null and non-object inputs", () => {
    expect(fillPayloadFromBindPolicy(null, null)).toEqual({});
    expect(fillPayloadFromBindPolicy([], { Price: "$3.98" })).toEqual({ Price: "$3.98" });
    expect(fillPayloadFromBindPolicy("x", undefined)).toEqual({});
    expect(
      fillPayloadFromBindPolicy({ type: "object", properties: { Price: { const: "$3.98" } } }, [
        "not-an-object",
      ]),
    ).toEqual({ Price: "$3.98" });
  });
});
