/**
 * Normalises a phone number to E.164 (`+2348012345678`).
 *
 * Accepts Nigerian local formats (`0801 234 5678`, `8012345678`, `2348012345678`,
 * `002348012345678`) and international numbers that start with `+`.
 * Returns null when the input is not a valid number.
 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/[^\d+\s\-().]/.test(trimmed)) return null;

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2);

  let international: string;
  if (hasPlus || digits.startsWith('234')) {
    international = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    international = `234${digits.slice(1)}`;
  } else if (digits.length === 10 && /^[789]/.test(digits)) {
    international = `234${digits}`;
  } else {
    return null;
  }

  if (international.startsWith('234')) {
    // Nigerian mobile numbers: 234 + 10 digits starting with 70, 71, 80, 81, 90 or 91.
    return /^234[789][01]\d{8}$/.test(international) ? `+${international}` : null;
  }
  // Other countries: E.164 allows up to 15 digits; country codes never start with 0.
  return /^[1-9]\d{7,14}$/.test(international) ? `+${international}` : null;
}
