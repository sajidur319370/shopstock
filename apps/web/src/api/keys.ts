export const qk = {
  setupStatus: ['setup-status'] as const,
  me: ['me'] as const,
  settings: ['settings'] as const,
  branches: ['branches'] as const,
  staff: ['staff'] as const,
  categories: ['categories'] as const,
  products: (f: object) => ['products', f] as const,
  product: (id: string) => ['product', id] as const,
  productSearch: (q: string) => ['product-search', q] as const,
  // Prefix keys ['inventory', code] / ['movements', code] invalidate every filter of that branch at once.
  inventory: (code: string, f: object) => ['inventory', code, f] as const,
  inventoryRow: (code: string, productId: string) => ['inventory-row', code, productId] as const,
  movements: (code: string, f: object) => ['movements', code, f] as const,
};
