/**
 * Normalize a function body so that copies with renamed variables,
 * different strings, or different formatting still match.
 *
 * Steps:
 *  1. strip comments
 *  2. replace string literals with S and numeric literals with N
 *  3. tokenize (identifiers / keywords / numbers / symbols)
 *  4. alpha-rename identifiers in order of first appearance
 *     (v0, v1, ...) so `formatDate(d)` and `formatDate(x)` normalize alike
 *  5. drop the function name itself from the signature — two helpers with
 *     different names but identical bodies are still the same helper
 */

const JS_KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "false", "finally",
  "for", "function", "if", "import", "in", "instanceof", "new", "null",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with", "yield", "let", "static", "await",
  "async", "of", "from", "get", "set", "type", "interface", "enum",
  "namespace", "declare", "readonly", "private", "public", "protected",
  "implements", "abstract", "as", "is", "keyof", "infer", "never", "unknown",
  "any", "string", "number", "boolean", "void",
]);

const PY_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass",
  "raise", "return", "try", "while", "with", "yield", "True", "False",
  "None", "print",
]);

export interface Normalized {
  /** Alpha-renamed token stream, joined with single spaces. */
  tokens: string;
  /** Hash of the token stream (exact-duplicate key). */
  hash: string;
  /** Token array (for shingle similarity). */
  tokenList: string[];
  /** Number of non-empty source lines in the raw body. */
  rawLines: number;
}

export function normalize(source: string, language: "ts" | "py"): Normalized {
  const stripped = language === "py" ? stripPyComments(source) : stripJsComments(source);
  const noStrings = replaceStrings(stripped);
  const noNumbers = noStrings.replace(/\b\d+(?:\.\d+)?\b/g, "N");
  const tokens = tokenize(noNumbers);
  const keywords = language === "py" ? PY_KEYWORDS : JS_KEYWORDS;

  // Alpha-rename identifiers, keeping keywords and symbols as-is.
  const renaming = new Map<string, string>();
  let counter = 0;
  const renamed = tokens.map((tok) => {
    if (/^[A-Za-z_$][\w$]*$/.test(tok) && !keywords.has(tok)) {
      let v = renaming.get(tok);
      if (v === undefined) {
        v = `v${counter++}`;
        renaming.set(tok, v);
      }
      return v;
    }
    return tok;
  });

  const joined = renamed.join(" ");
  return {
    tokens: joined,
    hash: simpleHash(joined),
    tokenList: renamed,
    rawLines: source.split("\n").filter((l) => l.trim() !== "").length,
  };
}

/** Remove the function name from the signature so same-body/different-name matches. */
export function bodyOnly(source: string, language: "ts" | "py"): string {
  if (language === "py") {
    // Drop the `def name(...)` line; keep the body.
    const idx = source.indexOf("\n");
    return idx === -1 ? source : source.slice(idx + 1);
  }
  // Drop everything up to the first `{` — the body is what matters.
  const idx = source.indexOf("{");
  return idx === -1 ? source : source.slice(idx);
}

function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^\S\\])\/\/.*$/gm, "$1");
}

function stripPyComments(src: string): string {
  return src.replace(/(^|[^#\\])#.*$/gm, "$1");
}

/** Replace string literals (single, double, backtick, py triple) with S. */
function replaceStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const triple = src.startsWith(ch.repeat(3), i);
      const end = triple ? ch.repeat(3) : ch;
      let j = i + end.length;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (triple ? src.startsWith(end, j) : src[j] === end) {
          j += end.length;
          break;
        }
        j++;
      }
      out += " S ";
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function tokenize(src: string): string[] {
  const m = src.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_$]/g);
  return m ?? [];
}

/** FNV-1a 32-bit hash, hex — good enough for an exact-match key. */
export function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
