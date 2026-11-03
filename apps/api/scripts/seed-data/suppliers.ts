/** database.md §11: the 5 demo suppliers. Products name theirs in products.ts. */
export const SUPPLIERS = [
  {
    name: 'Fresh Foods Ltd',
    contactName: 'Rahim Uddin',
    phone: '01711-100100',
    email: 'orders@freshfoods.test',
  },
  {
    name: 'Bengal Oils',
    contactName: 'Nasreen Akter',
    phone: '01711-200200',
    email: 'sales@bengaloils.test',
  },
  {
    name: 'Spice Route',
    contactName: 'Kamal Hossain',
    phone: '01711-300300',
    email: 'hello@spiceroute.test',
  },
  {
    name: 'CleanHome Supplies',
    contactName: 'Farida Begum',
    phone: '01711-400400',
    email: 'orders@cleanhome.test',
  },
  { name: 'Dairy Fresh', contactName: 'Jamal Mia', phone: '01711-500500', email: 'supply@dairyfresh.test' },
] as const;

export type SupplierName = (typeof SUPPLIERS)[number]['name'];
