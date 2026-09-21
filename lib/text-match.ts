/**
 * TEXT-MATCH-V1
 *
 * Token matching for the Brain image matcher. Pulled out of
 * lib/brain-image-match.ts so the matching rule can be tested on its own,
 * because the rule it replaces was quietly wrong.
 *
 * What it replaces
 * ----------------
 * The old test was `tag.includes(word) || word.includes(tag)` — substring
 * containment in either direction, with no length floor on the tag side.
 * Short tags are exactly what a vision model emits for a UK tourism library,
 * and every one of these fires today:
 *
 *   tag "pub"  matches "published"     tag "tea" matches "team"
 *   tag "bar"  matches "barriers"      tag "sun" matches "sunday"
 *   tag "art"  matches "start-ups"     tag "ice" matches "service"
 *
 * Each false positive is a photo scoring a point it did not earn, which in a
 * ranking where the top score wins is the difference between the right photo
 * and a random one.
 *
 * The rule here instead: normalise both sides to a stem, then require exact
 * equality. Stemming is a short, deliberately conservative suffix strip —
 * enough for coast/coastal, walk/walking, shop/shops, beach/beaches, and
 * nothing like enough to confuse pub with published.
 */

/**
 * Suffixes stripped to form a stem, longest first so "ies" is tried before
 * "s" and "ing" before "g"-less forms. Deliberately short: every entry here
 * is a chance to collapse two unrelated words, so the list stays at the
 * inflections that actually matter for photo tags.
 */
const SUFFIXES = ['ies', 'ing', 'ers', 'ed', 'es', 'er', 'al', 's'];

/**
 * Minimum length of a stem. Below this, a token only ever matches an
 * identical token — no suffix logic at all. This is the floor that stops
 * three-letter tags matching half the dictionary.
 */
export const MIN_STEM = 4;

/**
 * Reduce a token to its stem. Applied to both sides of every comparison, so
 * it only has to be self-consistent, not linguistically correct.
 */
export function stem(token: string): string {
  const t = token.toLowerCase();
  if (t.length <= MIN_STEM) return t;
  for (const suffix of SUFFIXES) {
    if (!t.endsWith(suffix)) continue;
    const base = t.slice(0, -suffix.length);
    // "ies" -> "y" (cities -> city), so those meet their singular.
    const candidate = suffix === 'ies' ? base + 'y' : base;
    // The floor applies to the STEM, not to the string before the suffix was
    // put back. Checking `base` instead cost "cities": base is "cit" (3), so
    // the ies rule was skipped, "es" fired instead, and "citi" never met
    // "city".
    if (candidate.length >= MIN_STEM) return candidate;
  }
  return t;
}

/*
 * A deliberate limitation, recorded so nobody "fixes" it by loosening the
 * rule: this does not split compounds. "hillwalking" stems to "hillwalk" and
 * will not meet "walk". Compound splitting is precisely how substring
 * matching produced "pub" / "published" in the first place, and the fix for a
 * genuinely missed match is the semantic shortlist (lib/image-shortlist.ts),
 * not a looser token rule.
 */

/**
 * Split free text into stemmed tokens. Handles kebab-case tags
 * ("high-street" -> high, street) and prose alike, since both arrive here.
 *
 * Unlike the old keywordsOf, there is no blanket "drop words of 3 or fewer
 * characters": that rule was applied to the QUERY only, which is what let a
 * three-letter TAG match anything. Stop words are removed by name instead,
 * so a genuinely meaningful short word ("bay", "inn", "pub") still counts —
 * it just has to match exactly.
 */
export function tokenise(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(w => !STOP_WORDS.has(w))
    .map(stem);
}

/** A stemmed, de-duplicated token set. */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenise(text));
}

/**
 * Words that carry no matching signal. Kept small and English-generic —
 * anything domain-specific belongs in the content, not in a stop list a
 * future reader can't audit.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'by', 'for', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'you', 'your', 'we', 'our',
  'they', 'their', 'not', 'no', 'so', 'up', 'out', 'off', 'over', 'into',
  'about', 'than', 'then', 'there', 'here', 'what', 'when', 'where', 'who',
  'how', 'all', 'any', 'each', 'one', 'two', 'do', 'does', 'did', 'has',
  'have', 'had', 'can', 'will', 'just', 'more', 'most', 'some', 'such',
  'only', 'own', 'same', 'too', 'very', 'via',
]);

/**
 * How many of `needles` appear in `haystack`. Both are stemmed token sets;
 * a token counts once however often it occurs, so a long description cannot
 * out-score a short one by repetition alone.
 */
export function overlapCount(haystack: Set<string>, needles: Set<string>): number {
  let n = 0;
  needles.forEach(t => { if (haystack.has(t)) n += 1; });
  return n;
}
