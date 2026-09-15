/**
 * Role-Based Access Control middleware.
 * ALWAYS enforced server-side. Frontend role checks are UX only.
 * Migrated to async Supabase client queries.
 */
const { supabase } = require('../config/db');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      // Generic error — do not reveal what role is required
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}

/**
 * Require that the farmer's profile is approved.
 * Applied after requireRole('farmer').
 */
async function requireApprovedFarmer(req, res, next) {
  try {
    const { data: profile, error } = await supabase
      .from('farmer_profiles')
      .select('verification_status')
      .eq('user_id', req.user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;

    if (!profile) {
      return res.status(403).json({ error: 'Farmer profile not found. Please complete your registration.' });
    }
    if (profile.verification_status !== 'approved') {
      return res.status(403).json({
        error: 'Your farmer profile is pending verification. Please wait for admin approval.',
        status: profile.verification_status,
      });
    }
    next();
  } catch (err) {
    console.error('[RBAC]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

/**
 * Require that the customer's profile is approved.
 */
async function requireApprovedCustomer(req, res, next) {
  try {
    const { data: profile, error } = await supabase
      .from('customer_profiles')
      .select('verification_status')
      .eq('user_id', req.user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;

    if (!profile) {
      return res.status(403).json({ error: 'Buyer profile not found. Please complete your registration.' });
    }
    if (profile.verification_status !== 'approved') {
      return res.status(403).json({
        error: 'Your buyer account is pending verification.',
        status: profile.verification_status,
      });
    }
    next();
  } catch (err) {
    console.error('[RBAC]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = { requireRole, requireApprovedFarmer, requireApprovedCustomer };
