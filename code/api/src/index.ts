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
import { seedDefaultCategoriesOnStartup } from './lib/seed-categories';

const app = express();
const PORT = Number.parseInt(process.env.API_PORT || '3000', 10);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost';

// Middleware
app.use(cors({ origin: corsOrigin }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/holdings', holdingRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/category-rules', categoryRuleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/loan-transactions', loanTransactionRoutes);

// Error handler (must be last)
app.use(errorHandler);

async function startServer() {
  try {
    await seedDefaultCategoriesOnStartup();

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
