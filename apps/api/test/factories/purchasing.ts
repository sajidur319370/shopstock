import { randomUUID } from 'node:crypto';
import type { PODto, SupplierDto } from '@shopstock/shared';
import { as } from '../helpers/auth';

type POLine = { productId: string; orderedQty: number; unitCost: number };

export async function makeSupplier(
  token: string,
  name = `Supplier ${Math.random().toString(36).slice(2, 7)}`,
) {
  const res = await as(token).post('/api/suppliers').send({ name });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.supplier as SupplierDto;
}

export async function draftPO(token: string, code: string, supplierId: string, lines: POLine[]) {
  const res = await as(token).post(`/api/b/${code}/purchase-orders`).send({ supplierId, lines });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.purchaseOrder as PODto;
}

export async function orderedPO(token: string, code: string, supplierId: string, lines: POLine[]) {
  const po = await draftPO(token, code, supplierId, lines);
  const res = await as(token).post(`/api/b/${code}/purchase-orders/${po.id}/order`);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.purchaseOrder as PODto;
}

/** Returns the raw response: tests assert status codes. */
export const receive = (
  token: string,
  code: string,
  poId: string,
  lines: { productId: string; qty: number; unitCost?: number }[],
  clientReceiptId: string = randomUUID(),
) => as(token).post(`/api/b/${code}/purchase-orders/${poId}/receive`).send({ clientReceiptId, lines });
