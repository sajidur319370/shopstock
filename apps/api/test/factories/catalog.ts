import type { CategoryDto, CreateProductInput, ProductDto } from '@shopstock/shared';
import { as } from '../helpers/auth';

let n = 0;

export async function makeCategory(token: string, name = `Cat ${++n}`) {
  const res = await as(token).post('/api/categories').send({ name });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.category as CategoryDto;
}

export async function makeProduct(token: string, over: Partial<CreateProductInput> & { categoryId: string }) {
  const res = await as(token)
    .post('/api/products')
    .send({ sku: `SKU-${++n}`, name: `Product ${n}`, price: 10_000, unit: 'pcs', reorderLevel: 5, ...over });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.product as ProductDto;
}
