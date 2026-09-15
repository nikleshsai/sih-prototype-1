const rateLimit = require('express-rate-limit');

/**
 * Strict rate limiter for auth endpoints (login, register).
 * 10 requests per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skipSuccessfulRequests: false,
});

/**
 * Moderate rate limiter for admin endpoints.
 * 60 requests per minute per IP.
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

/**
 * General API rate limiter.
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

module.exports = { authLimiter, adminLimiter, generalLimiter };
