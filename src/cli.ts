/**
 * four-versions — find the four versions of every helper your agents wrote.
 *
 * Usage:
 *   four-versions [dir] [--threshold 0.85] [--min-lines 5]
 *                  [--format text|json|md] [--out file]
 *                  [--fail-on-duplicates]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanDirectory, statSafe } from "./scan.js";
import { renderJson, renderMarkdown, renderText } from "./report.js";

function usage(): string {
  return [
    "four-versions — find duplicate helpers in a codebase",
    "",
    "Usage: four-versions [dir] [options]",
    "",
    "  dir                      directory to scan (default: .)",
    "  --threshold <0..1>       min similarity for near-duplicates (default 0.85)",
    "  --min-lines <n>          ignore functions shorter than n lines (default 5)",
    "  --format <text|json|md>  output format (default text)",
    "  --out <file>             write the report to a file instead of stdout",
    "  --fail-on-duplicates     exit 1 when any duplicate cluster is found",
    "  --help                   show this help",
    "",
    "Example: four-versions ./src --threshold 0.8 --fail-on-duplicates",
  ].join("\n");
}

export function main(argv: string[]): number {
  let dir = ".";
  let threshold = 0.85;
  let minLines = 5;
  let format: "text" | "json" | "md" = "text";
  let out: string | undefined;
  let failOnDuplicates = false;

  const args = [...argv];
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === "--help" || a === "-h") {
      console.log(usage());
      return 0;
    } else if (a === "--threshold") {
      threshold = Number(args.shift());
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        console.error("error: --threshold must be between 0 and 1");
        return 2;
      }
    } else if (a === "--min-lines") {
      minLines = Number(args.shift());
      if (!Number.isInteger(minLines) || minLines < 1) {
        console.error("error: --min-lines must be a positive integer");
        return 2;
      }
    } else if (a === "--format") {
      const f = args.shift();
      if (f !== "text" && f !== "json" && f !== "md") {
        console.error("error: --format must be text, json, or md");
        return 2;
      }
      format = f;
    } else if (a === "--out") {
      out = args.shift();
      if (!out) {
        console.error("error: --out needs a file path");
        return 2;
      }
    } else if (a === "--fail-on-duplicates") {
      failOnDuplicates = true;
    } else if (a.startsWith("-")) {
      console.error(`error: unknown option ${a}`);
      console.error(usage());
      return 2;
    } else {
      dir = a;
    }
  }

  const root = resolve(dir);
  if (!statSafe(root)) {
    console.error(`error: not a directory: ${dir}`);
    return 2;
  }

  const result = scanDirectory(root, { threshold, minLines });
  const rendered =
    format === "json"
      ? renderJson(result)
      : format === "md"
        ? renderMarkdown(result)
        : renderText(result);

  if (out) writeFileSync(out, rendered + "\n", "utf8");
  else console.log(rendered);

  if (failOnDuplicates && result.clusters.length > 0) return 1;
  return 0;
}
