require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verifies JWT from Authorization header or cookie.
 * Attaches decoded payload to req.user.
 * Role is read from the token (set server-side at login), never from client input.
 */
function authenticate(req, res, next) {
  let token = null;

  // 1. Authorization header (Bearer <token>)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // 2. Fallback: access_token cookie
  if (!token && req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      email: decoded.email,
    };
    next();
  } catch (err) {
    // Generic error — do not reveal whether token is expired, invalid, or malformed
    return res.status(401).json({ error: 'Authentication required' });
  }
}

/**
 * Optional authentication — does not fail if no token present.
 * Useful for public endpoints that optionally personalize.
 */
function optionalAuthenticate(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token && req.cookies && req.cookies.access_token) token = req.cookies.access_token;

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.sub, role: decoded.role, email: decoded.email };
  } catch (_) { /* ignore */ }
  next();
}

module.exports = { authenticate, optionalAuthenticate };
