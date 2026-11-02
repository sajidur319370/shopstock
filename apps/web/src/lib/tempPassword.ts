// No look-alikes (0/O, 1/l/I): this password is read out loud or typed from a note.
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LETTERS + DIGITS;

const pick = (chars: string, n: number) => {
  const bytes = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

/** 12 characters, at least one letter and one digit (passwordSchema), from crypto.getRandomValues. */
export function generateTempPassword(): string {
  const chars = (pick(LETTERS, 1) + pick(DIGITS, 1) + pick(ALL, 10)).split('');
  const order = crypto.getRandomValues(new Uint32Array(chars.length));
  return chars
    .map((c, i) => [c, order[i]!] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c)
    .join('');
}
