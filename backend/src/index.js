require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const { authenticate } = require('./middleware/auth');
const { requireRole } = require('./middleware/rbac');
const { auditMiddleware } = require('./middleware/audit');
const { generalLimiter, adminLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin/index');
const farmerRoutes = require('./routes/farmer/index');
const customerRoutes = require('./routes/customer/index');
const { supabase } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4000;

// ============================================================
// CORS — Allow configured frontend origins
// ============================================================
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3001', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed for: ' + origin));
  },
  credentials: true,
}));

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com', 'https://fonts.googleapis.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://api.razorpay.com', ...allowedOrigins],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Serve uploaded files
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(path.resolve(uploadDir)));

// ============================================================
// ROUTES
// ============================================================

// General rate limit on all API routes
app.use('/api', generalLimiter);

// Auth routes (no role required)
app.use('/api/auth', authRoutes);

// Admin routes — authenticate + requireRole('admin') + audit
app.use('/api/admin',
  authenticate,
  requireRole('admin'),
  adminLimiter,
  auditMiddleware,
  adminRoutes
);

// Farmer routes — authenticate + requireRole('farmer')
app.use('/api/farmer',
  authenticate,
  requireRole('farmer'),
  farmerRoutes
);

// Customer routes — authenticate + requireRole('customer')
app.use('/api/customer',
  authenticate,
  requireRole('customer'),
  customerRoutes
);

// Public API — crop reference data, public demand overview
app.get('/api/public/crops', async (req, res) => {
  const { data: crops } = await supabase
    .from('crop_yield_reference')
    .select('crop_name, season')
    .order('crop_name');
  const unique = [...new Map((crops || []).map(c => [c.crop_name, c])).values()];
  res.json({ crops: unique });
});

app.get('/api/public/districts', async (req, res) => {
  const { data: districts } = await supabase
    .from('demand_history')
    .select('region_district')
    .order('region_district');
  const unique = [...new Set((districts || []).map(d => d.region_district))];
  res.json({ districts: unique });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// ============================================================
// ERROR HANDLING
// ============================================================
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum 5MB per file.' });
  }
  if (err.message === 'Only image files allowed') {
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ error: 'CORS policy violation' });
  }

  console.error('[SERVER ERROR]', err.message);
  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).json({ error: 'Not found' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log('\n🌾 Farm-to-Buyer Platform — Backend API');
  console.log(`🚀 Running at: http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`💾 Database: Supabase PostgreSQL`);
  console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
  console.log('\nCommands:');
  console.log('  npm run migrate  — run schema migration');
  console.log('  npm run seed     — seed demo data\n');
});

module.exports = app;
