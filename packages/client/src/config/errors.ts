import type z from "zod";

function formatIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  return `  - ${where}: ${issue.message}`;
}

function buildMessage(issues: readonly z.core.$ZodIssue[], sourcePath?: string): string {
  const where = sourcePath !== undefined ? ` (${sourcePath})` : "";
  if (issues.length === 0) return `Invalid Vellum config${where}.`;
  return [`Invalid Vellum config${where}:`, ...issues.map(formatIssue)].join("\n");
}

/** Thrown when merged config fails validation or a file cannot be parsed. */
export class VellumConfigError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];
  readonly sourcePath: string | undefined;
  constructor(issues: readonly z.core.$ZodIssue[], sourcePath?: string) {
    super(buildMessage(issues, sourcePath));
    this.name = "VellumConfigError";
    this.issues = issues;
    this.sourcePath = sourcePath;
  }
}
