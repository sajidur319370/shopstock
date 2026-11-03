import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
 * NFR-SEC-07. The app's limiters skip the test environment (base.skip), so this builds one with the
 * same options minus `skip`, keyed per user like apiLimiter.
 */
describe('rate limit', () => {
  it('429 with Retry-After after the limit, counted per user (not per IP)', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { ctx: { userId: string } }).ctx = { userId: String(req.headers['x-user']) };
      next();
    });
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 2,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        keyGenerator: (r) => String((r as unknown as { ctx: { userId: string } }).ctx.userId),
      }),
    );
    app.get('/', (_req, res) => res.send('ok'));
    const as = (u: string) => request(app).get('/').set('x-user', u);

    await as('u1');
    await as('u1');
    const third = await as('u1');
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect((await as('u2')).status).toBe(200); // same IP, another user: its own budget
  });

  it('login: only FAILED attempts count, so a shop full of cashiers on one IP can all log in', async () => {
    const app = express();
    app.use(express.json());
    app.use(rateLimit({ windowMs: 60_000, limit: 2, skipSuccessfulRequests: true }));
    app.post('/login', (req, res) => {
      res.status(req.body.ok ? 200 : 401).end();
    });
    const login = (ok: boolean) => request(app).post('/login').send({ ok });

    for (let i = 0; i < 5; i++) expect((await login(true)).status).toBe(200); // 5 good logins: never limited
    expect((await login(false)).status).toBe(401);
    expect((await login(false)).status).toBe(401);
    expect((await login(false)).status).toBe(429); // the 3rd failure hits the wall
  });
});
