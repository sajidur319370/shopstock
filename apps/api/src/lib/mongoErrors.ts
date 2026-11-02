export const isDuplicateKey = (err: unknown, index?: string) => {
  const e = err as { code?: number; message?: string };
  return e?.code === 11000 && (!index || (e.message ?? '').includes(`index: ${index}`));
};
