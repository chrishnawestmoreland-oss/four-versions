/**
 * Extract function definitions from source files.
 *
 * Zero-dependency, regex + brace-matching extraction. It is deliberately
 * approximate: the goal is to find duplicated helpers, not to build an AST.
 * Supported: TypeScript / JavaScript (.ts, .tsx, .js, .jsx, .mjs, .cjs)
 * and Python (.py).
 */

export interface FunctionDef {
  /** Function name as written, or "anonymous". */
  name: string;
  /** File the function was found in (as given). */
  file: string;
  /** 1-based line where the definition starts. */
  line: number;
  /** 1-based line where the body ends. */
  endLine: number;
  /** Raw source text of the whole definition, including signature. */
  source: string;
  language: "ts" | "py";
}

const DEFAULT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
]);

export function isSupported(file: string): boolean {
  const dot = file.lastIndexOf(".");
  if (dot === -1) return false;
  return DEFAULT_EXTS.has(file.slice(dot).toLowerCase());
}

export function extractFunctions(file: string, text: string): FunctionDef[] {
  if (file.endsWith(".py")) return extractPython(file, text);
  return extractJsTs(file, text);
}

/* ------------------------------------------------------------------ */
/* JavaScript / TypeScript                                             */
/* ------------------------------------------------------------------ */

const JS_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "else",
  "return",
  "try",
  "finally",
  "do",
  "with",
  "class",
  "new",
  "typeof",
  "await",
  "yield",
]);

interface JsCandidate {
  name: string;
  start: number; // index of the definition start
  brace: number; // index of the opening brace of the body
}

/** Find candidate function starts in JS/TS source, in file order. */
function findJsCandidates(text: string): JsCandidate[] {
  const out: JsCandidate[] = [];
  // Strip strings and comments first so braces inside them don't confuse
  // the matcher — but keep positions identical by blanking, not removing.
  const blanked = blankJs(text);

  const patterns: RegExp[] = [
    // function name(...) { ... }  (declarations + named function expressions)
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
    // const name = (...) => { ... } / const name = async (...) => { ... }
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g,
    // const name = async function(...) { ... } / const name = function(...) { ... }
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\*?\s*\(/g,
    // methodName(...) { ... } — class / object methods (line-anchored)
    /(?:^|[;{}]\s*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/gm,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(blanked)) !== null) {
      const name = m[1];
      if (JS_KEYWORDS.has(name)) continue;
      // For the method pattern, the brace is the last char of the match.
      const brace = blanked.indexOf("{", m.index + m[0].length - 1);
      if (brace === -1) continue;
      out.push({ name, start: m.index, brace });
    }
  }

  // Deduplicate by brace position (patterns overlap), keep earliest start.
  const byBrace = new Map<number, JsCandidate>();
  for (const c of out.sort((a, b) => a.brace - b.brace || a.start - b.start)) {
    if (!byBrace.has(c.brace)) byBrace.set(c.brace, c);
  }
  return [...byBrace.values()].sort((a, b) => a.start - b.start);
}

function extractJsTs(file: string, text: string): FunctionDef[] {
  const lines = text.split("\n");
  const defs: FunctionDef[] = [];
  const seen = new Set<string>();

  for (const cand of findJsCandidates(text)) {
    const end = matchBrace(text, cand.brace);
    if (end === -1) continue;
    // Skip nested functions: if this body starts inside an already-accepted
    // function body, still record it — nested helpers are real duplicates too.
    // But skip exact re-matches of the same span.
    const key = `${cand.brace}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = text.slice(cand.start, end + 1);
    const line = lineOf(lines, cand.start);
    const endLine = lineOf(lines, end);
    // Ignore tiny one-liners (getters, trivial wrappers are handled by
    // --min-lines at scan time, but keep the raw list complete here).
    defs.push({
      name: cand.name,
      file,
      line: line + 1,
      endLine: endLine + 1,
      source,
      language: "ts",
    });
  }
  return defs;
}

/** Return the index of the closing brace matching the `{` at `open`, or -1. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  let i = open;
  let state: "code" | "sq" | "dq" | "bt" | "line" | "block" = "code";
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = "sq";
        i++;
        continue;
      }
      if (ch === '"') {
        state = "dq";
        i++;
        continue;
      }
      if (ch === "`") {
        state = "bt";
        i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    } else if (state === "line") {
      if (ch === "\n") state = "code";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
    } else if (state === "sq") {
      if (ch === "\\") i++;
      else if (ch === "'") state = "code";
    } else if (state === "dq") {
      if (ch === "\\") i++;
      else if (ch === '"') state = "code";
    } else if (state === "bt") {
      if (ch === "\\") i++;
      else if (ch === "`") state = "code";
      else if (ch === "$" && next === "{") {
        // Template interpolation: treat ${ ... } as code with its own depth.
        // Simplest safe approach: scan the interpolation with a sub-counter.
        const close = matchBrace(text, i + 1);
        if (close === -1) return -1;
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/** Blank out strings and comments (replaced with spaces) for safe regexing. */
function blankJs(text: string): string {
  const out = text.split("");
  let state: "code" | "sq" | "dq" | "bt" | "line" | "block" = "code";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        continue;
      }
      if (ch === "'") state = "sq";
      else if (ch === '"') state = "dq";
      else if (ch === "`") state = "bt";
    } else if (state === "line") {
      if (ch === "\n") state = "code";
      else out[i] = " ";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "code";
        i++;
      } else if (ch !== "\n") out[i] = " ";
    } else if (state === "sq") {
      if (ch === "\\") {
        out[i] = " ";
        if (i + 1 < text.length) out[i + 1] = " ";
        i++;
      } else if (ch === "'") state = "code";
      else if (ch !== "\n") out[i] = " ";
    } else if (state === "dq") {
      if (ch === "\\") {
        out[i] = " ";
        if (i + 1 < text.length) out[i + 1] = " ";
        i++;
      } else if (ch === '"') state = "code";
      else if (ch !== "\n") out[i] = " ";
    } else if (state === "bt") {
      if (ch === "\\") {
        out[i] = " ";
        if (i + 1 < text.length) out[i + 1] = " ";
        i++;
      } else if (ch === "`") state = "code";
      else if (ch !== "\n") out[i] = " ";
    }
  }
  return out.join("");
}

/* ------------------------------------------------------------------ */
/* Python                                                              */
/* ------------------------------------------------------------------ */

function extractPython(file: string, text: string): FunctionDef[] {
  const lines = text.split("\n");
  const defs: FunctionDef[] = [];
  const defRe = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const name = m[2];
    let end = i;
    // Body = following lines that are blank, comments, or more indented.
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "" || l.trim().startsWith("#")) {
        end = j;
        continue;
      }
      const cur = l.match(/^(\s*)/)?.[1].length ?? 0;
      if (cur > indent) {
        end = j;
        continue;
      }
      break;
    }
    defs.push({
      name,
      file,
      line: i + 1,
      endLine: end + 1,
      source: lines.slice(i, end + 1).join("\n"),
      language: "py",
    });
  }
  return defs;
}

function lineOf(lines: string[], index: number): number {
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    pos += lines[i].length + 1;
    if (pos > index) return i;
  }
  return lines.length - 1;
}
