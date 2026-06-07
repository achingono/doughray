const NOISE_WORDS = new Set([
  'interac', 'purchase', 'payment', 'withdrawal', 'posted', 'visa', 'debit', 'credit', 'eft',
  'transfer', 'internet', 'recurring', 'from', 'to', 'the', 'bank', 'canada',
]);

export function normalizePayee(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replaceAll(/\d/g, ' ')
    .replaceAll(/[^a-z\s]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'unknown-merchant';

  const tokens = cleaned
    .split(' ')
    .filter((token) => token.length > 1 && !NOISE_WORDS.has(token))
    .slice(0, 4);

  return tokens.join(' ') || 'unknown-merchant';
}
