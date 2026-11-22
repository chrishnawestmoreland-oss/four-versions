# four-versions

**Find the four versions of every helper your agents wrote.**

A week of agent-written code leaves a codebase 3x bigger, full of helpers that
already exist somewhere else — four versions of `formatDate`, three copies of
`slugify`, none of them quite the one the next agent will find. `four-versions`
is a zero-dependency CLI that scans a codebase, extracts every function, and
clusters the exact and near-duplicate copies — including copies with renamed
variables, different strings, or different formatting — then tells you which
one to keep.

## The loophole

Agents promise leverage and deliver duplication. Each session starts from its
own context, so to reuse a helper it has to find it first — and once a search
returns four near-identical candidates, writing a fifth looks safer than
picking wrong. Reviewers can't keep up, and the duplicates compound: more code
for every later agent to read past, more tokens per change. Existing duplicate
detectors are either whole-file hash tools, IDE features, or heavyweight
analysers. Nothing small, offline, and CI-ready answers the one question that
matters after an agent-heavy week: **which helpers exist more than once, and
which copy is canonical?**

## Install

```sh
npm install -g four-versions
# or run from source
git clone https://github.com/chrishnawestmoreland-oss/four-versions
cd four-versions
npm install   # no dependencies — this only installs the TypeScript compiler
npm run build
```

Requires Node 18+.

## Usage

```sh
four-versions ./src
four-versions ./src --threshold 0.8 --min-lines 8
four-versions ./src --format md --out dupes.md
four-versions ./src --fail-on-duplicates   # exit 1 when duplicates exist (CI)
```

Options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--threshold <0..1>` | `0.85` | Minimum shingle similarity for near-duplicates |
| `--min-lines <n>` | `5` | Ignore functions shorter than n lines |
| `--format <text\|json\|md>` | `text` | Report format |
| `--out <file>` | — | Write the report to a file instead of stdout |
| `--fail-on-duplicates` | — | Exit 1 when any duplicate cluster is found |

## Example output

```
four-versions — ./src
scanned 142 files, 318 functions (>= min lines)
2 duplicate cluster(s), 31 wasted line(s) across copies.

#1 — 3 exact copies, 18 wasted lines
  keep: formatDate — utils/date.ts:12 (14 references)
  dup:  formatDateString — lib/helpers.ts:44 (9 lines, 3 refs, exact)
  dup:  format_date — scripts/util.py:8 (9 lines, 1 refs)

#2 — 2 near-duplicates (min similarity 0.91), 13 wasted lines
  keep: parseConfig — config/load.ts:30 (22 references)
  dup:  loadConfigFile — config/parse.ts:17 (13 lines, 2 refs)

Name collisions — same helper name, different bodies:
  slugify: utils/text.ts:8, lib/slug.ts:21
```

## How it works

1. **Extract** — a brace-matching scanner pulls function definitions out of
   TypeScript/JavaScript (declarations, arrow functions, methods) and Python
   (`def`, indentation-based). No parser, no dependencies.
2. **Normalize** — comments stripped, string and numeric literals replaced,
   identifiers alpha-renamed in order of first appearance. Two copies that
   differ only by variable names or string contents normalize to the same
   token stream.
3. **Cluster** — 5-token shingle Jaccard similarity (threshold 0.85 by
   default). Exact copies score 1.0; near-copies with a line or two changed
   still cluster.
4. **Canonical pick** — the copy with the most references across the codebase
   wins; ties break to the earliest file. Everything else is a `dup:` to
   delete.
5. **Name collisions** — the same helper name defined in two files with
   different bodies is reported separately, because that is the "which one is
   real?" problem.

## CI

```yaml
- run: npx four-versions ./src --fail-on-duplicates --format md --out dupes.md
```

## Demo

```sh
npm run demo   # scans the bundled fixtures: 2 copies of a date helper + a name collision
```

## Limitations

- Extraction is regex + brace-matching, not a full AST: exotic syntax
  (computed method names, decorators with generics) can be missed, and
  one-liner arrow functions without braces are skipped.
- Similarity is structural, not semantic: two functions that do the same thing
  in genuinely different ways will not cluster.
- Cross-language matching (TS vs Python) works only when the normalized token
  streams happen to align; treat it as a bonus, not a guarantee.

## License

MIT
