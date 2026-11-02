import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './setup/app';
import { validate, valid } from '../src/middleware/validate';
import { errorHandler } from '../src/middleware/errorHandler';
import { withTransaction } from '../src/db/transaction';
import { User } from '../src/db/models';

describe('backbone', () => {
  it('GET /health → 200', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('unknown route → 404 in the standard error format', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('unknown /api route without a token → 401 (secure by default: no route discovery)', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(401);
  });

  it('malformed JSON → 400 INVALID_JSON', async () => {
    const res = await request(app).post('/api/x').set('Content-Type', 'application/json').send('{"a":');
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects $-keys in the body', async () => {
    const res = await request(app)
      .post('/api/x')
      .send({ email: { $ne: null } });
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('validate() parses and types the body', async () => {
    const schemas = { body: z.object({ qty: z.number().int().min(1) }) };
    const mini = express()
      .use(express.json())
      .post('/x', validate(schemas), (req, res) => {
        res.json(valid(req, schemas).body);
      })
      .use(errorHandler);

    expect((await request(mini).post('/x').send({ qty: 3 })).body).toEqual({ qty: 3 });
    const bad = await request(mini).post('/x').send({ qty: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].field).toBe('qty');
  });

  it('withTransaction rolls back when the callback throws', async () => {
    await expect(
      withTransaction(async (session) => {
        await User.create([{ email: 'a@test.dev', name: 'A', passwordHash: 'x', role: 'cashier' }], {
          session,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await User.countDocuments()).toBe(0);
  });
});
