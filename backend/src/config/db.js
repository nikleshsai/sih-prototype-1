require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// Validate required environment variables at startup
// ============================================================
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Copy backend/.env.example to backend/.env and fill in your Supabase credentials.\n');
  process.exit(1);
}

/**
 * Supabase client initialized with the SERVICE ROLE key.
 * This key bypasses Row Level Security — NEVER expose it to the frontend.
 * All database access goes through this server-side client only.
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // We manage our own JWT auth — disable Supabase Auth session handling
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  }
);

module.exports = { supabase };
