#!/usr/bin/env bun
import path from "node:path";
import { vellumConfigJsonSchema } from "../src/config/json-schema";

const out = path.resolve(import.meta.dir, "..", "vellum-config.schema.json");
const json = `${JSON.stringify(vellumConfigJsonSchema(), null, 2)}\n`;
await Bun.write(out, json);
await Bun.$`bunx biome format --write ${out}`.quiet();
console.log(`wrote ${path.relative(process.cwd(), out)}`);
