const { supabase } = require('../config/db');

/**
 * Writes an audit log entry (async Supabase version).
 * Audit logs are append-only — no updates or deletes permitted.
 */
async function writeAuditLog(opts) {
  try {
    await supabase.from('audit_logs').insert({
      admin_user_id: opts.adminUserId || null,
      user_email: opts.userEmail || null,
      action: opts.action,
      target_entity: opts.targetEntity || null,
      target_id: opts.targetId || null,
      result: opts.result || 'success',
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      ip_address: opts.ipAddress || null,
      user_agent: opts.userAgent || null,
    });
  } catch (err) {
    // Audit failures must never crash the request
    console.error('[AUDIT] Failed to write audit log:', err.message);
  }
}

/**
 * Express middleware — attaches req.audit() helper for admin route handlers.
 */
function auditMiddleware(req, res, next) {
  req.audit = (action, targetEntity, targetId, result, metadata) => {
    writeAuditLog({
      adminUserId: req.user ? req.user.id : null,
      userEmail: req.user ? req.user.email : null,
      action,
      targetEntity,
      targetId,
      result: result || 'success',
      metadata,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
    }).catch(() => {}); // fire-and-forget
  };
  next();
}

module.exports = { writeAuditLog, auditMiddleware };
