import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env, isProd } from './config/env';
import { httpLogger } from './lib/httpLogger';
import { rejectDollarKeys } from './middleware/rejectDollarKeys';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: correct req.ip for rate limits, secure cookies
  app.disable('x-powered-by');

  app.use(httpLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"], // no inline scripts, no CDNs: an injected <script> never runs
          // Inline STYLES can't run code: the receipt's @page <style> and Radix/Recharts positioning need them.
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"], // same-origin API only
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"], // no clickjacking
        },
      },
      hsts: isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(rejectDollarKeys);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/ready', async (_req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('not connected');
      await mongoose.connection.db!.admin().ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api', apiRouter);

  // Production: ONE service serves the API and the built React app (same origin: first-party refresh
  // cookie, no CORS). src/ and dist/ are both one level below apps/api, so this path works from either.
  if (isProd) {
    const dist = path.resolve(import.meta.dirname, '../../web/dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // SPA fallback: a reload on /b/GUL/pos must return index.html. /api/* misses still reach the 404 handler.
    app.get('/{*splat}', (req, res, next) =>
      req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html')),
    );
  }

  app.use(notFoundHandler); // after all routes
  app.use(errorHandler); // last
  return app;
}
