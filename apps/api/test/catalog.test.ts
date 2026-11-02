import { beforeEach, describe, expect, it } from 'vitest';
import type { CategoryDto, ProductDto } from '@shopstock/shared';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';
import { makeCategory, makeProduct } from './factories/catalog';
import { Product } from '../src/db/models';

const names = (body: { results: ProductDto[] }) => body.results.map((p) => p.name);

describe('catalog', () => {
  let s: Shop;
  let cat: CategoryDto;
  beforeEach(async () => {
    s = await makeShop();
    cat = await makeCategory(s.owner.token, 'Oil & Ghee');
  });

  it('SKU is uppercased and unique ignoring case (AC-CAT-01)', async () => {
    const p = await makeProduct(s.owner.token, { categoryId: cat.id, sku: 'rice-5kg' });
    expect(p.sku).toBe('RICE-5KG');
    const dup = await as(s.owner.token)
      .post('/api/products')
      .send({ sku: 'Rice-5kg', name: 'Other', price: 100, categoryId: cat.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SKU_TAKEN');
  });

  it('many products without a barcode are fine; duplicate barcodes are not', async () => {
    await makeProduct(s.owner.token, { categoryId: cat.id });
    await makeProduct(s.owner.token, { categoryId: cat.id }); // both barcode: null
    const blank = await makeProduct(s.owner.token, { categoryId: cat.id, barcode: '' as unknown as null }); // empty form field
    expect(blank.barcode).toBeNull();
    await makeProduct(s.owner.token, { categoryId: cat.id, barcode: '8901234567890' });
    const dup = await as(s.owner.token)
      .post('/api/products')
      .send({ sku: 'X1', name: 'Dup', price: 100, categoryId: cat.id, barcode: '8901234567890' });
    expect(dup.body.error.code).toBe('BARCODE_TAKEN');
    expect(await Product.countDocuments({ barcode: null })).toBe(3);
  });

  it('search: exact barcode first, then prefix, then words (AC-CAT-02)', async () => {
    const oil = await makeProduct(s.owner.token, {
      categoryId: cat.id,
      name: 'Soybean Oil 1L',
      barcode: '8941100500017',
    });
    await makeProduct(s.owner.token, { categoryId: cat.id, name: '8941100500017 Gift Pack' }); // same leading digits
    await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Mustard Oil 500ml' });

    const byCode = await as(s.cashierGul.token).get('/api/products/search?q=8941100500017');
    expect(byCode.body.exactId).toBe(oil.id);
    expect(byCode.body.results[0].id).toBe(oil.id);
    expect(names(byCode.body)).toEqual(['Soybean Oil 1L', '8941100500017 Gift Pack']); // no duplicate of the exact hit

    const byPrefix = await as(s.cashierGul.token).get('/api/products/search?q=soy');
    expect(names(byPrefix.body)).toEqual(['Soybean Oil 1L']);
    expect(byPrefix.body.exactId).toBeNull();

    const byWord = await as(s.cashierGul.token).get('/api/products/search?q=oil');
    expect(names(byWord.body).sort()).toEqual(['Mustard Oil 500ml', 'Soybean Oil 1L']);
  });

  it('exact SKU match, typed in any case', async () => {
    const p = await makeProduct(s.owner.token, { categoryId: cat.id, sku: 'SUGAR-1KG', name: 'Sugar 1kg' });
    const res = await as(s.cashierGul.token).get('/api/products/search?q=sugar-1kg');
    expect(res.body.exactId).toBe(p.id);
  });

  it('regex characters in the query are literal', async () => {
    await makeProduct(s.owner.token, { categoryId: cat.id, name: 'C++ (x) Cleaner' });
    const res = await as(s.cashierGul.token).get(`/api/products/search?q=${encodeURIComponent('C++ (x')}`);
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['C++ (x) Cleaner']);
    const dot = await as(s.cashierGul.token).get('/api/products/search?q=.');
    expect(dot.body.results).toEqual([]); // "." is a literal dot, not "any character"
  });

  it('archived products are not searchable', async () => {
    const p = await makeProduct(s.owner.token, {
      categoryId: cat.id,
      name: 'Old Tea',
      barcode: '1111222233334',
    });
    await as(s.owner.token).patch(`/api/products/${p.id}`).send({ isActive: false });
    expect((await as(s.cashierGul.token).get('/api/products/search?q=old')).body.results).toEqual([]);
    const scan = await as(s.cashierGul.token).get('/api/products/search?q=1111222233334');
    expect(scan.body).toEqual({ exactId: null, results: [] });
  });

  it('renaming a product updates the name it is found by', async () => {
    const p = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Old Name' });
    await as(s.owner.token).patch(`/api/products/${p.id}`).send({ name: 'Brand New Name' });
    expect(names((await as(s.cashierGul.token).get('/api/products/search?q=brand')).body)).toEqual([
      'Brand New Name',
    ]);
    expect((await as(s.cashierGul.token).get('/api/products/search?q=old')).body.results).toEqual([]);
  });

  it('price change stamps priceUpdatedAt; other edits do not', async () => {
    const p = await makeProduct(s.owner.token, { categoryId: cat.id });
    const rename = await as(s.managerGul.token).patch(`/api/products/${p.id}`).send({ name: 'Renamed' });
    expect(rename.body.product.priceUpdatedAt).toBeNull();
    const res = await as(s.managerGul.token).patch(`/api/products/${p.id}`).send({ price: 12_500 });
    expect(res.body.product.price).toBe(12_500);
    expect(res.body.product.priceUpdatedAt).not.toBeNull();
  });

  it('rejects a float price and an unknown category', async () => {
    const float = await as(s.owner.token)
      .post('/api/products')
      .send({ sku: 'F1', name: 'Float', price: 12.5, categoryId: cat.id });
    expect(float.status).toBe(400);
    const unknown = await as(s.owner.token)
      .post('/api/products')
      .send({ sku: 'F2', name: 'Nowhere', price: 100, categoryId: '0123456789abcdef01234567' });
    expect(unknown.body.error.code).toBe('INVALID_CATEGORY');
  });

  it('list: A→Z, filters, and a cursor that pages through everything exactly once', async () => {
    const other = await makeCategory(s.owner.token, 'Snacks');
    await Product.insertMany(
      Array.from({ length: 53 }, (_, i) => ({
        sku: `BULK-${i}`,
        name: `Item ${String(i).padStart(2, '0')}`,
        nameLower: `item ${String(i).padStart(2, '0')}`,
        categoryId: i % 2 ? cat.id : other.id,
        price: 100,
        createdBy: s.owner.user.id,
      })),
    );
    const p1 = await as(s.cashierGul.token).get('/api/products');
    expect(p1.body.items).toHaveLength(50);
    expect(p1.body.items[0].name).toBe('Item 00');
    const p2 = await as(s.cashierGul.token).get(`/api/products?cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((p: ProductDto) => p.name)).toEqual(['Item 50', 'Item 51', 'Item 52']);
    expect(p2.body.nextCursor).toBeNull();

    const snacks = await as(s.cashierGul.token).get(`/api/products?categoryId=${other.id}&q=item 1`);
    expect(snacks.body.items.map((p: ProductDto) => p.name)).toEqual([
      'Item 10',
      'Item 12',
      'Item 14',
      'Item 16',
      'Item 18',
    ]);
    expect((await as(s.cashierGul.token).get('/api/products?cursor=garbage')).body.error.code).toBe(
      'INVALID_CURSOR',
    );
  });

  it('GET /products/:id; a bad id is a 400, a missing one a 404', async () => {
    const p = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Detail Me' });
    expect((await as(s.cashierGul.token).get(`/api/products/${p.id}`)).body.product.name).toBe('Detail Me');
    expect((await as(s.cashierGul.token).get('/api/products/nope')).status).toBe(400);
    expect((await as(s.cashierGul.token).get('/api/products/0123456789abcdef01234567')).status).toBe(404);
  });

  it('categories: unique ignoring case, rename, and no delete while in use', async () => {
    const dup = await as(s.owner.token).post('/api/categories').send({ name: 'oil & ghee' });
    expect(dup.body.error.code).toBe('CATEGORY_TAKEN');
    const snacks = await makeCategory(s.owner.token, 'Snacks');
    const clash = await as(s.owner.token).patch(`/api/categories/${snacks.id}`).send({ name: 'OIL & GHEE' });
    expect(clash.body.error.code).toBe('CATEGORY_TAKEN'); // rename sets nameLower, so the index catches it
    await makeProduct(s.owner.token, { categoryId: cat.id });
    expect((await as(s.owner.token).delete(`/api/categories/${cat.id}`)).body.error.code).toBe(
      'CATEGORY_IN_USE',
    );
    expect((await as(s.owner.token).delete(`/api/categories/${snacks.id}`)).status).toBe(204);
  });

  it('cashiers can search and list but not create', async () => {
    expect((await as(s.cashierGul.token).get('/api/categories')).status).toBe(200);
    expect((await as(s.cashierGul.token).post('/api/products').send({})).status).toBe(403);
    expect((await as(s.cashierGul.token).post('/api/categories').send({ name: 'X' })).status).toBe(403);
  });
});
