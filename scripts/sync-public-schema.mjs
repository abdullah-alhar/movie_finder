import { database } from '../admin-store.js';

try {
  process.loadEnvFile?.();
} catch {}

console.log('Connecting to Neon PostgreSQL...');
let client;
try {
  client = await database().connect();
  console.log('Connected.');

  // Check data in aftershow_express
  const { rows: admins } = await client.query('SELECT email FROM aftershow_express.admin');
  const { rows: settings } = await client.query('SELECT config FROM aftershow_express.settings');
  const { rows: audits } = await client.query('SELECT count(*) FROM aftershow_express.audit');
  console.log(`\nVerified data in aftershow_express schema:`);
  console.log(`- Admin account: ${admins[0]?.email || 'None'}`);
  console.log(`- Active providers: ${JSON.stringify(settings[0]?.config || {})}`);
  console.log(`- Total audit log entries: ${audits[0]?.count || 0}`);

  // Create views in public schema so they appear in Neon Console under "public" schema list
  console.log('\nCreating views in public schema for Neon Console...');
  await client.query(`
    CREATE OR REPLACE VIEW public.express_admin AS SELECT * FROM aftershow_express.admin;
    CREATE OR REPLACE VIEW public.express_settings AS SELECT * FROM aftershow_express.settings;
    CREATE OR REPLACE VIEW public.express_audit AS SELECT * FROM aftershow_express.audit;
    CREATE OR REPLACE VIEW public.express_sessions AS SELECT * FROM aftershow_express.sessions;
  `);
  console.log('Successfully created:');
  console.log('  public.express_admin');
  console.log('  public.express_settings');
  console.log('  public.express_audit');
  console.log('  public.express_sessions');
  console.log('\nDone! Now in Neon Console under the "public" schema, you will see express_admin, express_settings, express_audit, and express_sessions with all data.');
} catch (err) {
  console.error('Error connecting to Neon:', err.message);
} finally {
  if (client) client.release();
  await database().end();
}
