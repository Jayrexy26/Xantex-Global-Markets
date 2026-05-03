/**
 * migrate.js — Run schema.sql against your Supabase project
 *
 * Usage:
 *   node migrate.js <SUPABASE_ACCESS_TOKEN>
 *
 * Get your Personal Access Token:
 *   https://supabase.com/dashboard/account/tokens  → "Generate new token"
 *
 * Example:
 *   node migrate.js sbp_abc123...
 */

const fs          = require('fs');
const path        = require('path');
const PROJECT_REF = 'ywnpzjjpighjhhqoxtsj';
const SQL_FILE    = path.join(__dirname, 'schema.sql');

async function run() {
  const token = process.argv[2];
  if (!token) {
    console.error('Usage: node migrate.js <SUPABASE_ACCESS_TOKEN>');
    console.error('Get your token at: https://supabase.com/dashboard/account/tokens');
    process.exit(1);
  }

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  console.log(`Running schema migration on project ${PROJECT_REF}...`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const body = await res.json().catch(() => res.text());

  if (!res.ok) {
    console.error('Migration failed:', JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log('✓ Migration completed successfully!');
  if (body && typeof body === 'object') console.log(JSON.stringify(body, null, 2));
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
