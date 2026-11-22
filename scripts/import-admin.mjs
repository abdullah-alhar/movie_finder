import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {database, digest, transaction} from '../admin-store.js';

const filename = process.argv[2];
if (!filename) throw new Error('Usage: node scripts/import-admin.mjs /path/to/admin-data.json');
const raw = await readFile(filename,'utf8');
const data = JSON.parse(raw);
if (!data.admin?.email || !/^pbkdf2\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(data.admin.passwordHash)
  || !Array.isArray(data.config?.customLinks) || !Array.isArray(data.activityLog)) throw new Error('Unexpected import format');
const ddl = await readFile(new URL('../migrations/express/001_admin.sql',import.meta.url),'utf8');
try {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('aftershow_express_import'))");
    await client.query(ddl);
    const {rows:[prior]} = await client.query('SELECT import_digest FROM aftershow_express.settings');
    if (prior) {
      if (prior.import_digest !== digest(raw)) throw new Error('Different input already imported');
      console.log('Already imported; existing records preserved.'); return;
    }
    await client.query('INSERT INTO aftershow_express.admin(email,password_hash) VALUES($1,$2)',[data.admin.email,data.admin.passwordHash]);
    await client.query('INSERT INTO aftershow_express.settings(config,import_digest) VALUES($1,$2)',[data.config,digest(raw)]);
    for (const event of [...data.activityLog].reverse()) await client.query('INSERT INTO aftershow_express.audit(event) VALUES($1)',[event]);
    const {rows:[checked]} = await client.query(`SELECT a.email,a.password_hash,s.config,
      (SELECT coalesce(jsonb_agg(event ORDER BY id DESC),'[]') FROM aftershow_express.audit) AS events
      FROM aftershow_express.settings s CROSS JOIN aftershow_express.admin a`);
    if (checked.email !== data.admin.email || checked.password_hash !== data.admin.passwordHash) throw new Error('Admin verification failed');
    // Avoid printing private records in assertions.
    try { assert.deepEqual(checked.config,data.config); assert.deepEqual(checked.events,data.activityLog); }
    catch { throw new Error('Import verification failed'); }
    console.log(`Verified 1 account, ${checked.config.customLinks.length} links, ${checked.events.length} events.`);
  });
} finally {await database().end();}
