/** Never build a regex from raw user input: "C++ (x" must match those characters, not crash. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
