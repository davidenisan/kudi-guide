/**
 * Typo tolerance for intent matching (Section 3: "fuzzy tolerance for typos").
 *
 * Tolerance scales with word length, because a one-character edit means very
 * different things in a 4-letter word and a 10-letter one. "last" and "fast"
 * are one edit apart and unrelated; "transaction" and "trasnaction" are one edit
 * apart and obviously the same word. Short words therefore get no tolerance at
 * all — typos in them are rarer, and false matches are costlier.
 */

/**
 * Insertions, deletions and substitutions are only forgiven on longer words.
 * On short ones a single such edit usually lands on a genuinely different word:
 * "sent" is one insertion from "spent", and treating them as equal turned a real
 * undo request into an ambiguous tie. Transpositions are handled separately and
 * far more generously, because they are nearly always typos.
 */
function toleranceFor(length: number): number {
  if (length <= 5) return 0;
  if (length <= 8) return 1;
  return 2;
}

/** Collapse repeated letters: "okk" -> "ok", "helloo" -> "helo", "hii" -> "hi". */
function deDouble(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/** Exactly one adjacent pair swapped — "worng" for "wrong", "remvoe" for "remove". */
function isSingleTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const differing: number[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      differing.push(i);
      if (differing.length > 2) return false;
    }
  }

  if (differing.length !== 2) return false;
  const [first, second] = differing;
  return second === first + 1 && a[first] === b[second] && a[second] === b[first];
}

/**
 * Damerau-Levenshtein distance (optimal string alignment), abandoned early once
 * it provably exceeds `max`.
 *
 * Transposition counts as one edit, not two, because swapped adjacent letters
 * are the most common way people mistype a word: "worng" for "wrong", "remvoe"
 * for "remove". Plain Levenshtein scores those as distance 2 and would push them
 * outside the tolerance a 5- or 6-letter word gets.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const rows = a.length;
  const columns = b.length;
  const distance: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));

  for (let i = 0; i <= rows; i += 1) distance[i][0] = i;
  for (let j = 0; j <= columns; j += 1) distance[0][j] = j;

  for (let i = 1; i <= rows; i += 1) {
    let rowBest = Number.POSITIVE_INFINITY;

    for (let j = 1; j <= columns; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        distance[i - 1][j] + 1,
        distance[i][j - 1] + 1,
        distance[i - 1][j - 1] + substitution,
      );

      // Adjacent transposition.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, distance[i - 2][j - 2] + 1);
      }

      distance[i][j] = best;
      rowBest = Math.min(rowBest, best);
    }

    if (rowBest > max) return max + 1;
  }

  return distance[rows][columns];
}

/**
 * Does a token from the user's message mean the same as a pattern word?
 * Handles exact match, shared stems ("spending" for "spend"), and typos.
 */
export function wordMatches(token: string, target: string): boolean {
  if (token === target) return true;

  // Stem tolerance, so a pattern word does not need every inflection listed.
  if (target.length >= 4 && token.startsWith(target)) return true;
  if (token.length >= 4 && target.startsWith(token)) return true;

  // Chat elongation and doubled-letter slips: "okk", "hii", "thankss".
  if (deDouble(token) === deDouble(target)) return true;

  const longest = Math.max(token.length, target.length);

  // Swapped adjacent letters are forgiven from 4 characters up.
  if (longest >= 4 && isSingleTransposition(token, target)) return true;

  const tolerance = toleranceFor(longest);
  return tolerance > 0 && editDistance(token, target, tolerance) <= tolerance;
}

/**
 * Do the pattern's words appear in the message, in order?
 *
 * Order-preserving but gap-tolerant, so the pattern "how much spent" matches
 * "how much have i spent this month". This is what lets a modest pattern list
 * cover a broad surface of real phrasings without enumerating each one.
 */
export function containsInOrder(tokens: string[], patternWords: string[]): boolean {
  let cursor = 0;
  for (const word of patternWords) {
    let found = -1;
    for (let i = cursor; i < tokens.length; i += 1) {
      if (wordMatches(tokens[i], word)) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}
