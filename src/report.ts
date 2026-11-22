/**
 * Render a ScanResult as human text, Markdown, or JSON.
 */

import type { ScanResult } from "./scan.js";

export function renderText(r: ScanResult): string {
  const out: string[] = [];
  out.push(`four-versions — ${r.root}`);
  out.push(`scanned ${r.filesScanned} files, ${r.functionsFound} functions (>= min lines)`);
  if (r.clusters.length === 0 && r.collisions.length === 0) {
    out.push("No duplicate helpers found. Your agents behaved themselves.");
    return out.join("\n");
  }
  out.push(
    `${r.clusters.length} duplicate cluster(s), ${r.totalWastedLines} wasted line(s) across copies.`,
  );
  for (const c of r.clusters) {
    const kind = c.similarity >= 1 ? "exact copies" : `near-duplicates (min similarity ${c.similarity.toFixed(2)})`;
    out.push("");
    out.push(`#${c.id} — ${c.members.length} ${kind}, ${c.wastedLines} wasted lines`);
    out.push(`  keep: ${c.canonical.name} — ${c.canonical.file}:${c.canonical.line} (${c.canonical.references} references)`);
    for (const m of c.members) {
      if (m === c.canonical) continue;
      out.push(
        `  dup:  ${m.name} — ${m.file}:${m.line} (${m.lines} lines, ${m.references} refs${m.exact ? ", exact" : ""})`,
      );
    }
  }
  if (r.collisions.length > 0) {
    out.push("");
    out.push("Name collisions — same helper name, different bodies:");
    for (const col of r.collisions) {
      out.push(`  ${col.name}: ${col.variants.map((v) => `${v.file}:${v.line}`).join(", ")}`);
    }
  }
  return out.join("\n");
}

export function renderMarkdown(r: ScanResult): string {
  const out: string[] = [];
  out.push("# four-versions report");
  out.push("");
  out.push(`Scanned \`${r.root}\`: ${r.filesScanned} files, ${r.functionsFound} functions.`);
  out.push("");
  if (r.clusters.length === 0 && r.collisions.length === 0) {
    out.push("No duplicate helpers found.");
    return out.join("\n");
  }
  out.push(
    `**${r.clusters.length} duplicate cluster(s), ${r.totalWastedLines} wasted lines.**`,
  );
  out.push("");
  for (const c of r.clusters) {
    const kind = c.similarity >= 1 ? "exact copies" : `near-duplicates (min similarity ${c.similarity.toFixed(2)})`;
    out.push(`## Cluster ${c.id} — ${c.members.length} ${kind}`);
    out.push("");
    out.push(`Keep **${c.canonical.name}** (\`${c.canonical.file}:${c.canonical.line}\`, ${c.canonical.references} references).`);
    out.push("");
    out.push("| Function | Location | Lines | References |");
    out.push("| --- | --- | ---: | ---: |");
    for (const m of c.members) {
      out.push(
        `| ${m.name}${m === c.canonical ? " ⭐ keep" : ""} | \`${m.file}:${m.line}\` | ${m.lines} | ${m.references} |`,
      );
    }
    out.push("");
  }
  if (r.collisions.length > 0) {
    out.push("## Name collisions");
    out.push("");
    out.push("Same helper name, different bodies — pick one and delete the rest.");
    out.push("");
    for (const col of r.collisions) {
      out.push(`- **${col.name}**: ${col.variants.map((v) => `\`${v.file}:${v.line}\``).join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function renderJson(r: ScanResult): string {
  return JSON.stringify(r, null, 2);
}
