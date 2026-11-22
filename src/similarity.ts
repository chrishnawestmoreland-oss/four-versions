/**
 * Similarity between two normalized token streams.
 *
 * Uses Jaccard similarity over 5-token shingles — robust to small edits
 * (a renamed variable is already normalized away; a changed line or two
 * only drops a few shingles). Exact duplicates score 1.0.
 */

export function shingles(tokens: string[], n = 5): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) {
    if (tokens.length > 0) out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(aTokens: string[], bTokens: string[]): number {
  return jaccard(shingles(aTokens), shingles(bTokens));
}
