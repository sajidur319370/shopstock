import type { Unit } from '@shopstock/shared';
import type { SupplierName } from './suppliers';

export const CATEGORIES = [
  'Rice & Grains',
  'Oil & Ghee',
  'Spices',
  'Snacks',
  'Beverages',
  'Dairy',
  'Personal Care',
  'Household',
] as const;
type Category = (typeof CATEGORIES)[number];

/** [sku, name, unit, price in TAKA] per category; cost, barcode and reorder level are derived below. */
const RAW: Record<Category, [string, string, Unit, number][]> = {
  'Rice & Grains': [
    ['RICE-MIN-5KG', 'Miniket Rice 5kg', 'bag', 450],
    ['RICE-NAZ-5KG', 'Nazirshail Rice 5kg', 'bag', 520],
    ['RICE-CHN-1KG', 'Chinigura Rice 1kg', 'pack', 150],
    ['RICE-BAS-1KG', 'Basmati Rice 1kg', 'pack', 290],
    ['DAL-MSR-1KG', 'Red Lentils 1kg', 'pack', 140],
    ['DAL-MUG-1KG', 'Mung Dal 1kg', 'pack', 165],
    ['ATTA-2KG', 'Atta Flour 2kg', 'pack', 130],
    ['MAIDA-1KG', 'Maida Flour 1kg', 'pack', 75],
    ['SUJI-500', 'Suji 500g', 'pack', 55],
    ['CHIRA-500', 'Flattened Rice (Chira) 500g', 'pack', 60],
  ],
  'Oil & Ghee': [
    ['OIL-SOY-1L', 'Soybean Oil 1L', 'bottle', 185],
    ['OIL-SOY-5L', 'Soybean Oil 5L', 'bottle', 890],
    ['OIL-MUS-500', 'Mustard Oil 500ml', 'bottle', 160],
    ['OIL-MUS-1L', 'Mustard Oil 1L', 'bottle', 310],
    ['OIL-RBO-1L', 'Rice Bran Oil 1L', 'bottle', 210],
    ['OIL-PALM-1L', 'Palm Oil 1L', 'bottle', 150],
    ['GHEE-200', 'Pure Ghee 200g', 'pcs', 340],
    ['GHEE-400', 'Pure Ghee 400g', 'pcs', 650],
    ['DALDA-500', 'Vegetable Ghee 500g', 'pcs', 210],
    ['OIL-OLV-250', 'Olive Oil 250ml', 'bottle', 480],
  ],
  Spices: [
    ['SPC-TUR-200', 'Turmeric Powder 200g', 'pack', 95],
    ['SPC-CHL-200', 'Chili Powder 200g', 'pack', 110],
    ['SPC-COR-200', 'Coriander Powder 200g', 'pack', 85],
    ['SPC-CUM-100', 'Cumin Powder 100g', 'pack', 120],
    ['SPC-GAR-100', 'Garam Masala 100g', 'pack', 130],
    ['SPC-BIR-50', 'Biryani Masala 50g', 'pack', 70],
    ['SALT-1KG', 'Iodized Salt 1kg', 'pack', 42],
    ['SUGAR-1KG', 'Sugar 1kg', 'pack', 140],
    ['SPC-CIN-50', 'Cinnamon 50g', 'pack', 90],
    ['SPC-CRD-25', 'Cardamom 25g', 'pack', 150],
  ],
  Snacks: [
    ['BIS-GLU-100', 'Glucose Biscuits 100g', 'pack', 20],
    ['BIS-CRM-150', 'Cream Biscuits 150g', 'pack', 45],
    ['BIS-DIG-250', 'Digestive Biscuits 250g', 'pack', 120],
    ['CHIP-POT-50', 'Potato Chips 50g', 'pack', 30],
    ['CHAN-250', 'Chanachur 250g', 'pack', 65],
    ['NOOD-MAS-8', 'Masala Noodles 8-pack', 'pack', 190],
    ['NOOD-CUP', 'Cup Noodles', 'pcs', 45],
    ['CAKE-SLC', 'Slice Cake', 'pcs', 25],
    ['CHOC-BAR', 'Chocolate Bar 40g', 'pcs', 60],
    ['MURI-500', 'Puffed Rice (Muri) 500g', 'pack', 50],
  ],
  Beverages: [
    ['TEA-400', 'Black Tea 400g', 'pack', 230],
    ['TEA-BAG-50', 'Tea Bags 50', 'box', 160],
    ['COF-INS-50', 'Instant Coffee 50g', 'pcs', 290],
    ['WTR-500', 'Mineral Water 500ml', 'bottle', 20],
    ['WTR-1500', 'Mineral Water 1.5L', 'bottle', 35],
    ['SODA-250', 'Soft Drink 250ml', 'bottle', 30],
    ['SODA-1L', 'Soft Drink 1L', 'bottle', 80],
    ['JUC-MNG-1L', 'Mango Juice 1L', 'bottle', 140],
    ['ENRG-250', 'Energy Drink 250ml', 'bottle', 45],
    ['HORL-500', 'Malted Drink 500g', 'pcs', 420],
  ],
  Dairy: [
    ['MILK-1L', 'Fresh Milk 1L', 'pack', 95],
    ['MILK-500', 'Fresh Milk 500ml', 'pack', 50],
    ['MILK-PWD-500', 'Milk Powder 500g', 'pack', 430],
    ['MILK-PWD-1KG', 'Milk Powder 1kg', 'pack', 840],
    ['DOI-500', 'Sweet Yogurt (Doi) 500g', 'pcs', 120],
    ['BUTR-200', 'Butter 200g', 'pcs', 260],
    ['CHSE-200', 'Cheese Slices 200g', 'pack', 320],
    ['EGG-12', 'Eggs (12)', 'pack', 150],
    ['CNDM-397', 'Condensed Milk 397g', 'pcs', 130],
    ['LASSI-250', 'Lassi 250ml', 'bottle', 40],
  ],
  'Personal Care': [
    ['SOAP-100', 'Bath Soap 100g', 'pcs', 65],
    ['SOAP-150', 'Beauty Soap 150g', 'pcs', 90],
    ['SHAM-180', 'Shampoo 180ml', 'bottle', 280],
    ['SHAM-SCH', 'Shampoo Sachet', 'pcs', 5],
    ['TPST-150', 'Toothpaste 150g', 'pcs', 150],
    ['TBRS-1', 'Toothbrush', 'pcs', 60],
    ['LOTN-200', 'Body Lotion 200ml', 'bottle', 320],
    ['HAIROIL-200', 'Coconut Hair Oil 200ml', 'bottle', 180],
    ['SANI-200', 'Hand Sanitizer 200ml', 'bottle', 140],
    ['RAZR-3', 'Disposable Razors (3)', 'pack', 110],
  ],
  Household: [
    ['DTRG-500', 'Detergent Powder 500g', 'pack', 95],
    ['DTRG-1KG', 'Detergent Powder 1kg', 'pack', 180],
    ['DISH-500', 'Dishwashing Liquid 500ml', 'bottle', 120],
    ['DISH-BAR', 'Dishwashing Bar', 'pcs', 25],
    ['FLR-1L', 'Floor Cleaner 1L', 'bottle', 210],
    ['TLT-500', 'Toilet Cleaner 500ml', 'bottle', 130],
    ['TISS-RL', 'Toilet Tissue Roll', 'pcs', 30],
    ['MOSQ-COIL', 'Mosquito Coil (10)', 'box', 85],
    ['MATCH-10', 'Matchbox (10)', 'pack', 20],
    ['BAG-GRB-30', 'Garbage Bags (30)', 'pack', 110],
  ],
};

const SUPPLIER_OF: Record<Category, SupplierName> = {
  'Rice & Grains': 'Fresh Foods Ltd',
  'Oil & Ghee': 'Bengal Oils',
  Spices: 'Spice Route',
  Snacks: 'Fresh Foods Ltd',
  Beverages: 'Spice Route',
  Dairy: 'Dairy Fresh',
  'Personal Care': 'CleanHome Supplies',
  Household: 'CleanHome Supplies',
};

/** EAN-13: 12 digits + a checksum (weights 1,3,1,3… from the left; the check digit makes Σ a multiple of 10). */
export function ean13(twelve: string): string {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return twelve + ((10 - (sum % 10)) % 10);
}

export type SeedProduct = {
  sku: string;
  name: string;
  barcode: string;
  unit: Unit;
  category: Category;
  supplier: SupplierName;
  price: number; // minor units
  cost: number; // minor units, 70–85% of the price
  reorderLevel: number;
};

/** ~80 products; deterministic (no PRNG): the same catalog on every run. */
export const PRODUCTS: SeedProduct[] = CATEGORIES.flatMap((category, ci) =>
  RAW[category].map(([sku, name, unit, taka], i) => {
    const n = ci * 10 + i;
    const price = taka * 100;
    const costPct = 70 + ((n * 7) % 16); // 70–85%
    return {
      sku,
      name,
      barcode: ean13(`8941100${String(n + 1).padStart(5, '0')}`), // 894: GS1 Bangladesh
      unit,
      category,
      supplier: SUPPLIER_OF[category],
      price,
      cost: Math.round((price * costPct) / 100),
      reorderLevel: taka <= 60 ? 30 : taka <= 200 ? 20 : 10, // cheap staples move faster
    };
  }),
);
