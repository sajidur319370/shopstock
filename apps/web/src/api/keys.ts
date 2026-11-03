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
  // ['returns', code] invalidates every returns-list filter of that branch after a return
  returns: (code: string, f: object) => ['returns', code, f] as const,
  saleReturn: (code: string, id: string) => ['return', code, id] as const,
  // ['suppliers'] invalidates every supplier list and pick-list after a supplier changes
  suppliers: (f: object) => ['suppliers', f] as const,
  supplier: (id: string) => ['supplier', id] as const,
  pos: (code: string, f: object) => ['pos', code, f] as const,
  po: (code: string, id: string) => ['po', code, id] as const,
  poSuggestions: (code: string) => ['po-suggestions', code] as const,
  // ['transfers', code] invalidates every list filter; a transfer is cached per viewing branch
  transfers: (code: string, f: object) => ['transfers', code, f] as const,
  transfer: (code: string, id: string) => ['transfer', code, id] as const,
  transferDestinations: (code: string) => ['transfer-destinations', code] as const,
  // ['dashboard', code] / ['low-stock', code]: invalidated after this tab's own sales, returns, receipts, transfers
  dashboard: (code: string) => ['dashboard', code] as const,
  overview: ['overview'] as const,
  lowStock: (code: string, f: object) => ['low-stock', code, f] as const,
};
