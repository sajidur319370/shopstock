import { LIMITS } from '@shopstock/shared';
import { Product } from '../../db/models';
import { isDefined, uniqueById } from '../../lib/ids';
import { escapeRegex } from '../../lib/regex';
import { PRODUCT_CARD } from './catalog.dto';

/**
 * In the order a counter needs it (queries.md §7.1):
 *   1. exact barcode  (uniq_barcode: a scanner typed the full code + Enter)
 *   2. exact SKU      (uniq_sku: cashiers learn the SKUs of common items)
 *   3. name prefix    ({ isActive, nameLower }: anchored regex on the lowercased field = index range scan)
 *   4. words          (product_text: "oil" finds "Soybean Oil 1L"; slower and ranked, so last)
 */
export async function searchProducts(q: string, limit: number = LIMITS.searchResults) {
  const term = q.trim();
  if (!term) return { results: [], exact: null };

  const [byBarcode, bySku] = await Promise.all([
    Product.findOne({ barcode: term, isActive: true }).select(PRODUCT_CARD).lean(),
    Product.findOne({ sku: term.toUpperCase(), isActive: true }).select(PRODUCT_CARD).lean(),
  ]);
  const exact = byBarcode ?? bySku ?? null;

  const prefix = await Product.find({
    isActive: true,
    nameLower: { $regex: `^${escapeRegex(term.toLowerCase())}` },
  })
    .select(PRODUCT_CARD)
    .sort({ nameLower: 1 })
    .limit(limit)
    .lean();

  let results = uniqueById([exact, ...prefix].filter(isDefined));

  // Only when the prefix left room, and the term is long enough to mean a word.
  if (results.length < limit && term.length >= 3) {
    const words = await Product.find({ $text: { $search: term }, isActive: true })
      .select(PRODUCT_CARD)
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean();
    results = uniqueById([...results, ...words]);
  }
  return { results: results.slice(0, limit), exact };
}
