/**
 * Scan a directory, extract functions, and cluster duplicates.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { extractFunctions, isSupported, type FunctionDef } from "./extract.js";
import { bodyOnly, normalize, type Normalized } from "./normalize.js";
import { similarity } from "./similarity.js";

export interface ScannedFunction extends FunctionDef {
  normalized: Normalized;
  /** How many times this function's name appears across the scanned files. */
  references: number;
}

export interface ClusterMember {
  name: string;
  file: string;
  line: number;
  endLine: number;
  lines: number;
  references: number;
  /** True when this member's normalized body is byte-identical to the cluster's. */
  exact: boolean;
}

export interface Cluster {
  /** 1-based, by size. */
  id: number;
  /** Highest pairwise similarity inside the cluster (1 = exact copies). */
  similarity: number;
  /** The member to keep: most referenced, then earliest. */
  canonical: ClusterMember;
  members: ClusterMember[];
  /** Lines that would disappear if all non-canonical copies were deleted. */
  wastedLines: number;
}

export interface NameCollision {
  name: string;
  /** Same name, different bodies — which one is real? */
  variants: { file: string; line: number; lines: number; hash: string }[];
}

export interface ScanResult {
  root: string;
  filesScanned: number;
  functionsFound: number;
  clusters: Cluster[];
  collisions: NameCollision[];
  totalWastedLines: number;
}

export interface ScanOptions {
  threshold?: number; // default 0.85
  minLines?: number; // default 5
  maxFiles?: number; // default 2000
}

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

export function scanDirectory(root: string, opts: ScanOptions = {}): ScanResult {
  const threshold = opts.threshold ?? 0.85;
  const minLines = opts.minLines ?? 5;
  const maxFiles = opts.maxFiles ?? 2000;

  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") {
        // Skip hidden dirs (except none we need); hidden files are skipped too.
        if (e.isDirectory() || e.isFile()) continue;
      }
      if (e.isDirectory()) {
        if (DEFAULT_IGNORE.has(e.name)) continue;
        walk(join(dir, e.name));
      } else if (e.isFile() && isSupported(e.name)) {
        files.push(join(dir, e.name));
        if (files.length >= maxFiles) return;
      }
    }
  };
  walk(root);

  const all: ScannedFunction[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const fn of extractFunctions(f, text)) {
      const body = bodyOnly(fn.source, fn.language);
      const normalized = normalize(body, fn.language);
      if (normalized.rawLines < minLines) continue;
      all.push({ ...fn, normalized, references: 0 });
    }
  }

  // Reference counts: how often each function name is mentioned anywhere.
  const nameCounts = new Map<string, number>();
  for (const fn of all) nameCounts.set(fn.name, 0);
  const wordRe = /[A-Za-z_$][\w$]*/g;
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const w of text.match(wordRe) ?? []) {
      if (nameCounts.has(w)) nameCounts.set(w, (nameCounts.get(w) ?? 0) + 1);
    }
  }
  for (const fn of all) fn.references = nameCounts.get(fn.name) ?? 0;

  // Cluster: union-find over pairs with similarity >= threshold.
  const parent = all.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Exact duplicates first (cheap hash grouping), then near-dup pairs.
  const byHash = new Map<string, number[]>();
  all.forEach((fn, i) => {
    const list = byHash.get(fn.normalized.hash) ?? [];
    list.push(i);
    byHash.set(fn.normalized.hash, list);
  });
  for (const list of byHash.values()) {
    for (let i = 1; i < list.length; i++) union(list[0], list[i]);
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (find(i) === find(j)) continue;
      // Skip pairs that are trivially different in size — shingle Jaccard
      // is size-sensitive, but this prunes the O(n^2) cost a little.
      const a = all[i].normalized.tokenList.length;
      const b = all[j].normalized.tokenList.length;
      if (Math.max(a, b) > 3 * Math.max(1, Math.min(a, b))) continue;
      if (similarity(all[i].normalized.tokenList, all[j].normalized.tokenList) >= threshold) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  all.forEach((_, i) => {
    const r = find(i);
    const list = groups.get(r) ?? [];
    list.push(i);
    groups.set(r, list);
  });

  const clusters: Cluster[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const members: ClusterMember[] = list
      .map((i) => {
        const fn = all[i];
        return {
          name: fn.name,
          file: relative(root, fn.file),
          line: fn.line,
          endLine: fn.endLine,
          lines: fn.normalized.rawLines,
          references: fn.references,
          exact: false,
        };
      })
      .sort((a, b) => b.references - a.references || a.file.localeCompare(b.file) || a.line - b.line);
    const canonical = members[0];
    const findIdx = (m: ClusterMember): number =>
      list.find((i) => all[i].file.endsWith(m.file) && all[i].line === m.line)!;
    const canonicalFn = all[findIdx(canonical)];
    let sim = 1;
    for (const m of members) {
      const fn = all[findIdx(m)];
      const s = similarity(canonicalFn.normalized.tokenList, fn.normalized.tokenList);
      if (s < sim) sim = s;
      m.exact = fn.normalized.hash === canonicalFn.normalized.hash;
    }
    const wasted = members
      .filter((m) => m !== canonical)
      .reduce((sum, m) => sum + m.lines, 0);
    clusters.push({ id: 0, similarity: sim, canonical, members, wastedLines: wasted });
  }
  clusters.sort((a, b) => b.wastedLines - a.wastedLines || b.members.length - a.members.length);
  clusters.forEach((c, i) => (c.id = i + 1));

  // Name collisions: same name, different bodies, different files.
  const byName = new Map<string, ScannedFunction[]>();
  for (const fn of all) {
    const list = byName.get(fn.name) ?? [];
    list.push(fn);
    byName.set(fn.name, list);
  }
  const collisions: NameCollision[] = [];
  for (const [name, fns] of byName) {
    if (name === "anonymous") continue;
    const hashes = new Set(fns.map((f) => f.normalized.hash));
    const filesSet = new Set(fns.map((f) => f.file));
    if (hashes.size > 1 && filesSet.size > 1) {
      collisions.push({
        name,
        variants: fns.map((f) => ({
          file: relative(root, f.file),
          line: f.line,
          lines: f.normalized.rawLines,
          hash: f.normalized.hash,
        })),
      });
    }
  }
  collisions.sort((a, b) => b.variants.length - a.variants.length);

  return {
    root,
    filesScanned: files.length,
    functionsFound: all.length,
    clusters,
    collisions,
    totalWastedLines: clusters.reduce((s, c) => s + c.wastedLines, 0),
  };
}

export function statSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
