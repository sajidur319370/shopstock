import { Router } from 'express';
import {
  createCategorySchema,
  createProductSchema,
  productListQuery,
  searchQuery,
  updateProductSchema,
  type SearchResponse,
} from '@shopstock/shared';
import { idParams, oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { toProductDto } from './catalog.dto';
import * as cats from './category.service';
import * as products from './product.service';
import { searchProducts } from './search.service';

// ---------- /api/categories ----------
export const categoriesRouter = Router();

categoriesRouter.get('/', authorize('catalog:view'), async (_req, res) => {
  res.json({ categories: await cats.listCategories() });
});

const createCatReq = { body: createCategorySchema };
categoriesRouter.post('/', authorize('catalog:manage'), validate(createCatReq), async (req, res) => {
  res.status(201).json({ category: await cats.createCategory(valid(req, createCatReq).body.name) });
});

const renameCatReq = { params: idParams, body: createCategorySchema };
categoriesRouter.patch('/:id', authorize('catalog:manage'), validate(renameCatReq), async (req, res) => {
  const { params, body } = valid(req, renameCatReq);
  res.json({ category: await cats.renameCategory(oid(params.id), body.name) });
});

const idReq = { params: idParams };
categoriesRouter.delete('/:id', authorize('catalog:manage'), validate(idReq), async (req, res) => {
  await cats.deleteCategory(oid(valid(req, idReq).params.id));
  res.status(204).end();
});

// ---------- /api/products ----------
export const productsRouter = Router();

// BEFORE '/:id', or Express treats "search" as an id.
const searchReq = { query: searchQuery };
productsRouter.get('/search', authorize('catalog:view'), validate(searchReq), async (req, res) => {
  const { results, exact } = await searchProducts(valid(req, searchReq).query.q);
  const body: SearchResponse = {
    exactId: exact ? String(exact._id) : null,
    results: results.map(toProductDto),
  };
  res.json(body);
});

const listReq = { query: productListQuery };
productsRouter.get('/', authorize('catalog:view'), validate(listReq), async (req, res) => {
  res.json(await products.listProducts(valid(req, listReq).query));
});

const createReq = { body: createProductSchema };
productsRouter.post('/', authorize('catalog:manage'), validate(createReq), async (req, res) => {
  res.status(201).json({ product: await products.createProduct(req.ctx, valid(req, createReq).body) });
});

productsRouter.get('/:id', authorize('catalog:view'), validate(idReq), async (req, res) => {
  res.json({ product: await products.getProduct(oid(valid(req, idReq).params.id)) });
});

const updateReq = { params: idParams, body: updateProductSchema };
productsRouter.patch('/:id', authorize('catalog:manage'), validate(updateReq), async (req, res) => {
  const { params, body } = valid(req, updateReq);
  res.json({ product: await products.updateProduct(req.ctx, oid(params.id), body) });
});

productsRouter.delete('/:id', authorize('catalog:manage'), validate(idReq), async (req, res) => {
  await products.deleteProduct(oid(valid(req, idReq).params.id));
  res.status(204).end();
});
