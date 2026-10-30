import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error-handler';
import accountRoutes from './routes/accounts';
import transactionRoutes from './routes/transactions';
import dashboardRoutes from './routes/dashboard';
import holdingRoutes from './routes/holdings';
import budgetRoutes from './routes/budgets';
import categoryRoutes from './routes/categories';
import categoryRuleRoutes from './routes/category-rules';
import reportRoutes from './routes/reports';
import syncRoutes from './routes/sync';
import assetRoutes from './routes/assets';
import goalRoutes from './routes/goals';
import loanTransactionRoutes from './routes/loan-transactions';
import authRoutes from './routes/auth';
import plaidRoutes from './routes/plaid';
import bankConnectionRoutes from './routes/bank-connections';
import bankReconciliationRoutes from './routes/bank-reconciliation';
import { seedDefaultCategoriesOnStartup } from './lib/seed-categories';
import { getBankConfigStatus } from './lib/bank-config';
import { ownerPasswordHashConfigured, requireOwnerSession } from './middleware/auth';

const app = express();
// Avoid disclosing the framework version in the `x-powered-by` response header.
app.disable('x-powered-by');
const PORT = Number.parseInt(process.env.API_PORT || '3000', 10);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost';
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "script-src-elem 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "style-src-elem 'self' 'unsafe-inline'",
  "style-src-attr 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ');

// Middleware
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  next();
});
// The verified Plaid webhook must see the exact raw bytes its body hash covers:
// capture them before the JSON parser consumes the stream.
app.use('/api/plaid/webhook', express.raw({ type: 'application/json', limit: '256kb' }));
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth (health, login and the verified webhook are the only public endpoints)
app.use('/api/auth', authRoutes);
app.use('/api/plaid', plaidRoutes);

// Financial/management routers: uniform owner-session guard.
app.use('/api/bank-connections', requireOwnerSession(), bankConnectionRoutes);
app.use('/api/bank-reconciliation', requireOwnerSession(), bankReconciliationRoutes);
app.use('/api/accounts', requireOwnerSession(), accountRoutes);
app.use('/api/transactions', requireOwnerSession(), transactionRoutes);
app.use('/api/dashboard', requireOwnerSession(), dashboardRoutes);
app.use('/api/holdings', requireOwnerSession(), holdingRoutes);
app.use('/api/budgets', requireOwnerSession(), budgetRoutes);
app.use('/api/categories', requireOwnerSession(), categoryRoutes);
app.use('/api/category-rules', requireOwnerSession(), categoryRuleRoutes);
app.use('/api/reports', requireOwnerSession(), reportRoutes);
app.use('/api/sync', requireOwnerSession(), syncRoutes);
app.use('/api/assets', requireOwnerSession(), assetRoutes);
app.use('/api/goals', requireOwnerSession(), goalRoutes);
app.use('/api/loan-transactions', requireOwnerSession(), loanTransactionRoutes);

// Error handler (must be last)
app.use(errorHandler);

async function startServer() {
  try {
    await seedDefaultCategoriesOnStartup();

    // Bank configuration check at startup: clear status, never secret values.
    // Missing or invalid settings disable linking clearly but do not crash the
    // API; only owner access depends on OWNER_PASSWORD_HASH.
    const bankStatus = getBankConfigStatus();
    if (bankStatus.issues.length > 0) {
      for (const issue of bankStatus.issues) {
        console.warn(`[Startup] Bank config: ${issue}`);
      }
    } else {
      console.log(`[Startup] Bank config: Plaid ${bankStatus.plaid.env} linking ready.`);
    }
    if (!ownerPasswordHashConfigured()) {
      console.warn('[Startup] Bank config: OWNER_PASSWORD_HASH is not provisioned; owner login is disabled.');
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`API server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Startup] Failed to initialize API:', err);
    process.exit(1);
  }
}

void startServer();

export default app;
