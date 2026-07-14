import type z from "zod";
import { VellumConfigError } from "./errors";
import { readVellumConfigFileWithExtends } from "./file";
import { mergeVellumAppConfigLayers } from "./merge";
import { normalizeVellumAppConfigRaw } from "./normalize";

export type LoadVellumAppConfigOptions<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  layers?: ReadonlyArray<unknown>;
  filePath?: string | null;
  filePathExplicit?: boolean;
  fs?: { readFileSync: (p: string) => string };
};

export type LoadedVellumAppConfig<TSchema extends z.ZodTypeAny> = {
  config: z.infer<TSchema>;
  sourcePath: string | undefined;
  extendsChain: string[];
};

export function loadVellumAppConfig<TSchema extends z.ZodTypeAny>(
  opts: LoadVellumAppConfigOptions<TSchema>,
): LoadedVellumAppConfig<TSchema> {
  let fileMerged: Record<string, unknown> | undefined;
  let sourcePath: string | undefined;
  let extendsChain: string[] = [];
  if (typeof opts.filePath === "string") {
    const fileRead = readVellumConfigFileWithExtends(opts.filePath, {
      explicit: opts.filePathExplicit ?? true,
      fs: opts.fs,
    });
    if (fileRead !== undefined) {
      fileMerged = fileRead.merged;
      sourcePath = fileRead.chain[fileRead.chain.length - 1];
      extendsChain = fileRead.chain;
    }
  }
  const allLayers: unknown[] = [...(opts.layers ?? [])];
  if (fileMerged !== undefined) allLayers.push(fileMerged);
  const merged = normalizeVellumAppConfigRaw(mergeVellumAppConfigLayers(allLayers));
  const result = opts.schema.safeParse(merged);
  if (!result.success) {
    throw new VellumConfigError(result.error.issues, sourcePath);
  }
  const parsed = result.data as Record<string, unknown>;
  delete parsed.extends;
  delete parsed.$schema;
  return {
    config: Object.freeze(parsed) as z.infer<TSchema>,
    sourcePath,
    extendsChain,
  };
}
