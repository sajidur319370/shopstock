import type { TransferDto } from '@shopstock/shared';
import { as } from '../helpers/auth';

export async function makeTransfer(
  token: string,
  from: string,
  to: string,
  lines: { productId: string; qty: number }[],
) {
  const res = await as(token).post(`/api/b/${from}/transfers`).send({ toBranchCode: to, lines });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.transfer as TransferDto;
}

/** Raw responses: tests assert status codes. */
export const dispatch = (token: string, code: string, id: string) =>
  as(token).post(`/api/b/${code}/transfers/${id}/dispatch`);
export const receiveTransfer = (token: string, code: string, id: string) =>
  as(token).post(`/api/b/${code}/transfers/${id}/receive`);
export const cancelTransfer = (token: string, code: string, id: string) =>
  as(token).post(`/api/b/${code}/transfers/${id}/cancel`);
