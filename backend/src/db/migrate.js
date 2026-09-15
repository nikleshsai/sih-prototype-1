/**
 * Database Migration Script
 * Runs the PostgreSQL schema against Supabase.
 * Usage: npm run migrate  (from backend/)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`\n❌ Missing: ${missing.join(', ')}`);
  console.error('   Fill in backend/.env from backend/.env.example\n');
  process.exit(1);
}

async function migrate() {
  console.log('\n🔧 Running database migration...');
  console.log(`   Supabase URL: ${process.env.SUPABASE_URL}`);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Read schema SQL
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Split on semicolons to run statement-by-statement
  // Skip empty statements and comments
  const statements = schemaSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let skipCount = 0;
  const errors = [];

  for (const stmt of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' });
      if (error) {
        // "already exists" errors are safe to skip during idempotent re-runs
        if (error.message && (
          error.message.includes('already exists') ||
          error.message.includes('duplicate') ||
          error.code === '42P07' || // duplicate table
          error.code === '42710'    // duplicate object
        )) {
          skipCount++;
        } else {
          errors.push({ statement: stmt.substring(0, 60) + '...', error: error.message });
        }
      } else {
        successCount++;
      }
    } catch (e) {
      errors.push({ statement: stmt.substring(0, 60) + '...', error: e.message });
    }
  }

  console.log(`\n✅ Statements executed: ${successCount}`);
  if (skipCount > 0) console.log(`   Skipped (already exists): ${skipCount}`);
  if (errors.length > 0) {
    console.warn(`\n⚠️  ${errors.length} statement(s) failed:`);
    errors.forEach(e => console.warn(`   [${e.statement}] → ${e.error}`));
    console.log('\n💡 If errors are about "exec_sql function not found", use the Supabase SQL Editor instead.');
    console.log('   Copy backend/src/db/schema.sql and run it in the Supabase dashboard.\n');
  } else {
    console.log('\n🎉 Migration complete!\n');
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
