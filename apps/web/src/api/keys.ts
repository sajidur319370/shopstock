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
  branch: (code: string) => ['branch', code] as const, // full branch (address, phone) for receipts
  // ['sales', code] invalidates every history filter of that branch after a sale
  sales: (code: string, f: object) => ['sales', code, f] as const,
  sale: (code: string, id: string) => ['sale', code, id] as const,
  shift: (code: string) => ['shift', code] as const,
};
