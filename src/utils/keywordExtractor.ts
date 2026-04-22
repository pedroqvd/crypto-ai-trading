// ================================================
// KEYWORD EXTRACTOR — shared text analysis utility
// Used by NewsApiClient and ConsensusClient to pull
// meaningful search terms from prediction market questions.
// ================================================

const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'be', 'is', 'are', 'was', 'were',
  'in', 'on', 'at', 'by', 'for', 'of', 'to', 'and', 'or', 'but',
  'if', 'that', 'this', 'which', 'who', 'what', 'when', 'where',
  'how', 'than', 'with', 'from', 'has', 'have', 'had', 'do', 'does',
  'did', 'not', 'no', 'more', 'its', 'their', 'any', 'during',
]);

/**
 * Extracts up to 6 meaningful keywords from a prediction market question.
 * Prioritizes proper nouns (capitalized) and longer words.
 * Returns words in their original case.
 */
export function extractKeywords(question: string): string[] {
  const words = question
    .replace(/[?.,!();:'"]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

  const scored = words.map(w => ({
    word: w,
    score: (w[0] !== w[0].toLowerCase() ? 2 : 0) + (w.length > 6 ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map(s => s.word);
}
