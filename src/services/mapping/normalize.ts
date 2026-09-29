const CONTACT_KEYS = new Set([
  "full name",
  "fullname",
  "first name",
  "firstname",
  "last name",
  "lastname",
  "email",
  "email address",
  "phone",
  "phone number",
  "mobile",
  "mobile phone",
  "city",
  "state",
  "province",
  "zip",
  "zip code",
  "postal code",
  "street address",
  "address",
]);

export function normalizeLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_./-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function humanizeKey(key: string): string {
  const cleaned = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return key;
  return cleaned.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function isContactField(key: string, label: string): boolean {
  const normalizedKey = normalizeLabel(key);
  const normalizedLabel = normalizeLabel(label);
  return CONTACT_KEYS.has(normalizedKey) || CONTACT_KEYS.has(normalizedLabel);
}

export function tokensOf(value: string): string[] {
  return normalizeLabel(value).split(" ").filter(Boolean);
}

export function similarity(left: string, right: string): number {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const leftTokens = new Set(tokensOf(left));
  const rightTokens = new Set(tokensOf(right));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const dice = leftTokens.size + rightTokens.size === 0 ? 0 : (2 * overlap) / (leftTokens.size + rightTokens.size);
  return Math.max(dice, levenshteinSimilarity(a, b));
}

function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  const distance = matrix[left.length]![right.length]!;
  return 1 - distance / Math.max(left.length, right.length);
}
