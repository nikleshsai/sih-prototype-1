require('dotenv').config();
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/db');
const { authLimiter } = require('../middleware/rateLimiter');
const { writeAuditLog } = require('../middleware/audit');
const { authenticate } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function issueTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
}

// ============================================================
// REGISTER
// ============================================================
router.post('/register', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .matches(/[A-Z]/).withMessage('Must have uppercase')
    .matches(/[a-z]/).withMessage('Must have lowercase')
    .matches(/[0-9]/).withMessage('Must have number')
    .matches(/[!@#$%^&*]/).withMessage('Must have special character'),
  body('role').isIn(['farmer', 'customer']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { email, password, role } = req.body;

    // Check existing user
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      // Generic error to prevent email enumeration
      return res.status(400).json({ error: 'Registration failed. Please check your details.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({ email, password_hash: hash, role, status: 'active' })
      .select('id')
      .single();

    if (insertError) {
      console.error('[REGISTER]', insertError.message);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }

    writeAuditLog({
      action: 'USER_REGISTER', targetEntity: 'users',
      targetId: newUser.id, userEmail: email, result: 'success',
      metadata: { role }, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      message: 'Registration successful. Please complete your profile.',
      userId: newUser.id, role,
    });
  }
);

// ============================================================
// LOGIN
// ============================================================
router.post('/login', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const { email, password } = req.body;
    const ip = req.ip;

    // Generic delay to prevent timing attacks
    await new Promise(r => setTimeout(r, 100 + Math.random() * 100));

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .neq('status', 'deleted')
      .maybeSingle();

    if (!user) {
      writeAuditLog({ action: 'LOGIN_FAILED', userEmail: email, result: 'failure', metadata: { reason: 'user_not_found' }, ipAddress: ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      writeAuditLog({ action: 'LOGIN_BLOCKED', userEmail: email, result: 'failure', metadata: { reason: 'account_locked' }, ipAddress: ip });
      return res.status(401).json({ error: 'Account temporarily locked. Please try again later.' });
    }

    if (user.status === 'suspended') {
      return res.status(401).json({ error: 'Account has been suspended. Contact admin.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const newCount = (user.failed_login_count || 0) + 1;
      let lockUntil = null;
      if (newCount >= 5) {
        const lockDate = new Date();
        lockDate.setMinutes(lockDate.getMinutes() + 15);
        lockUntil = lockDate.toISOString();
      }
      await supabase.from('users').update({
        failed_login_count: newCount,
        locked_until: lockUntil,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);

      writeAuditLog({ action: 'LOGIN_FAILED', adminUserId: user.id, userEmail: email, result: 'failure', metadata: { attempts: newCount }, ipAddress: ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success — reset lock
    await supabase.from('users').update({
      failed_login_count: 0,
      locked_until: null,
      last_login: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);

    const { accessToken, refreshToken } = issueTokens(user);

    res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS);
    res.cookie('access_token', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });

    writeAuditLog({ action: 'LOGIN_SUCCESS', adminUserId: user.id, userEmail: email, result: 'success', metadata: { role: user.role }, ipAddress: ip });

    res.json({
      message: 'Login successful',
      accessToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  }
);

// ============================================================
// REFRESH TOKEN
// ============================================================
router.post('/refresh', async (req, res) => {
  const token = req.cookies.refresh_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');

    const { data: user } = await supabase
      .from('users')
      .select('id, email, role, status')
      .eq('id', decoded.sub)
      .maybeSingle();

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { accessToken, refreshToken } = issueTokens(user);
    res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS);
    res.cookie('access_token', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });

    res.json({ accessToken, user: { id: user.id, email: user.email, role: user.role } });
  } catch {
    res.clearCookie('refresh_token');
    res.clearCookie('access_token');
    return res.status(401).json({ error: 'Authentication required' });
  }
});

// ============================================================
// LOGOUT
// ============================================================
router.post('/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.decode(token);
      if (decoded) {
        writeAuditLog({ action: 'LOGOUT', adminUserId: decoded.sub, userEmail: decoded.email, result: 'success', ipAddress: req.ip });
      }
    }
  } catch (_) {}
  res.clearCookie('refresh_token');
  res.clearCookie('access_token');
  res.json({ message: 'Logged out successfully' });
});

// ============================================================
// ME — Get current user info
// ============================================================
router.get('/me', authenticate, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, email, role, status, created_at')
    .eq('id', req.user.id)
    .maybeSingle();

  if (!user) return res.status(401).json({ error: 'Authentication required' });
  res.json({ user });
});

module.exports = router;
