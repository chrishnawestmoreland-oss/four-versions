import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanDirectory } from "../src/scan.js";
import { extractFunctions } from "../src/extract.js";
import { normalize, bodyOnly } from "../src/normalize.js";
import { similarity } from "../src/similarity.js";
import { main } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const duplicated = join(root, "fixtures", "duplicated");
const clean = join(root, "fixtures", "clean");

test("extracts TS functions and a Python def", () => {
  const ts = extractFunctions(
    "a.ts",
    `export function foo(x: string): string {\n  return x.trim();\n}\nconst bar = (n: number) => {\n  return n * 2;\n};`,
  );
  assert.equal(ts.length, 2);
  assert.deepEqual(
    ts.map((f) => f.name).sort(),
    ["bar", "foo"],
  );

  const py = extractFunctions(
    "c.py",
    `def greet(name):\n    return f"hi {name}"\n\ndef other():\n    pass\n`,
  );
  assert.equal(py.length, 2);
  assert.equal(py[0].name, "greet");
});

test("normalization erases renamed variables and strings", () => {
  const a = normalize(
    bodyOnly(
      `function f(d) {\n  const y = d.getFullYear();\n  return "x" + y;\n}`,
      "ts",
    ),
    "ts",
  );
  const b = normalize(
    bodyOnly(
      `function g(input) {\n  const year = input.getFullYear();\n  return "y" + year;\n}`,
      "ts",
    ),
    "ts",
  );
  assert.equal(a.hash, b.hash);
  assert.equal(similarity(a.tokenList, b.tokenList), 1);
});

test("similarity drops for genuinely different bodies", () => {
  const a = normalize(bodyOnly(`function f(x) {\n  return x * 2 + 1;\n}`, "ts"), "ts");
  const b = normalize(
    bodyOnly(
      `function g(s) {\n  const out = [];\n  for (const c of s) out.push(c.toUpperCase());\n  return out.join("");\n}`,
      "ts",
    ),
    "ts",
  );
  assert.ok(similarity(a.tokenList, b.tokenList) < 0.5);
});

test("duplicated fixture: one cluster, renamed-variable copies found", () => {
  const r = scanDirectory(duplicated, { minLines: 5 });
  assert.ok(r.functionsFound >= 4, `expected >=4 functions, got ${r.functionsFound}`);
  assert.equal(r.clusters.length, 1);
  const c = r.clusters[0];
  assert.equal(c.members.length, 2);
  assert.deepEqual(
    c.members.map((m) => m.name).sort(),
    ["formatDate", "formatDateString"],
  );
  assert.equal(c.similarity, 1);
  assert.ok(c.wastedLines > 0);
  // Canonical is the most-referenced copy.
  assert.equal(c.canonical.name, "formatDate");
});

test("duplicated fixture: slugify name collision is reported", () => {
  // minLines 3: the b.ts slugify is only 3 lines long.
  const r = scanDirectory(duplicated, { minLines: 3 });
  const col = r.collisions.find((c) => c.name === "slugify");
  assert.ok(col, "expected a slugify collision");
  assert.equal(col.variants.length, 2);
});

test("clean fixture: no clusters, no collisions", () => {
  const r = scanDirectory(clean, { minLines: 5 });
  assert.equal(r.clusters.length, 0);
  assert.equal(r.collisions.length, 0);
});

test("CLI: exit 1 with --fail-on-duplicates on duplicated fixture", () => {
  assert.equal(main([duplicated, "--fail-on-duplicates", "--format", "json"]), 1);
  assert.equal(main([clean, "--fail-on-duplicates"]), 0);
});

test("CLI: rejects bad options", () => {
  assert.equal(main(["--threshold", "2"]), 2);
  assert.equal(main(["--format", "yaml"]), 2);
  assert.equal(main(["/definitely/not/a/dir"]), 2);
});
