import z from "zod";
import { zVellumAppConfigBase } from "./schema";

export function vellumConfigJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(zVellumAppConfigBase, {
    unrepresentable: "any",
    target: "draft-2020-12",
  });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...generated,
  };
}
