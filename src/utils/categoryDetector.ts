// ================================================
// CATEGORY DETECTOR — shared market classification
// Used by RiskManager (concentration limits) and
// PerformanceMetrics (P&L attribution by category).
// ================================================

export function detectMarketCategory(question: string): string {
  const q = question.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|crypto|defi|nft|blockchain|solana|sol)\b/.test(q)) return 'Crypto';
  if (/\b(election|president|vote|senator|congress|governor|parliament|prime minister)\b/.test(q)) return 'Politics';
  if (/\b(fed|interest rate|inflation|gdp|recession|economy|employment|cpi)\b/.test(q)) return 'Economics';
  if (/\b(nba|nfl|nhl|mlb|soccer|football|basketball|tennis|golf|olympic)\b/.test(q)) return 'Sports';
  if (/\b(ai|artificial intelligence|chatgpt|openai|google|microsoft|apple|meta|amazon)\b/.test(q)) return 'Tech / AI';
  if (/\b(war|conflict|military|nato|russia|ukraine|china|taiwan|iran|north korea)\b/.test(q)) return 'Geopolitics';
  if (/\b(climate|carbon|temperature|hurricane|earthquake|weather|environment)\b/.test(q)) return 'Science / Climate';
  if (/\b(covid|vaccine|fda|drug|clinical trial|cancer|disease|pandemic)\b/.test(q)) return 'Health / Bio';
  return 'Other';
}
