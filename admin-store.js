try { process.loadEnvFile?.(); } catch {}
import pg from 'pg';
import { createHash } from 'node:crypto';

let pool;
export function database() {
  if (!process.env.EXPRESS_DATABASE_URL) throw new Error('EXPRESS_DATABASE_URL is required');
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.EXPRESS_DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 60000,
    });
    pool.on('error', (err) => {
      console.warn('[db pool warning]', err.message);
    });
  }
  return pool;
}
export async function transaction(run) {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}
export const digest = value => createHash('sha256').update(value).digest('hex');

// In-memory caching for ultra-fast admin dashboard and config loads
let cachedData = null;
let cachedDataTime = 0;
const DATA_CACHE_TTL = 30_000; // 30 seconds

export function invalidateCache() {
  cachedData = null;
  cachedDataTime = 0;
}

export async function loadData(client = database(), bypassCache = false) {
  if (!bypassCache && client === database() && cachedData && (Date.now() - cachedDataTime < DATA_CACHE_TTL)) {
    return JSON.parse(JSON.stringify(cachedData));
  }
  const {rows: [row]} = await client.query(`SELECT s.config,s.revision,a.email,a.password_hash,
    (SELECT coalesce(jsonb_agg(event ORDER BY id DESC),'[]') FROM
      (SELECT id,event FROM aftershow_express.audit ORDER BY id DESC LIMIT 60) e) AS events
    FROM aftershow_express.settings s CROSS JOIN aftershow_express.admin a`);
  if (!row) throw new Error('Admin data has not been imported');
  cachedData = {config:row.config, revision:row.revision, admin:{email:row.email,passwordHash:row.password_hash},activityLog:row.events};
  cachedDataTime = Date.now();
  return JSON.parse(JSON.stringify(cachedData));
}
export async function saveData(data, {revoke = false, session} = {}) {
  invalidateCache();
  await transaction(async client => {
    await client.query(`
      INSERT INTO aftershow_express.settings(id, config, revision, import_digest)
      VALUES(true, $1, 1, 'admin-save')
      ON CONFLICT (id) DO UPDATE SET config = $1, revision = aftershow_express.settings.revision + 1
    `, [data.config]);
    if (data.activityLog?.[0]) {
      await client.query('INSERT INTO aftershow_express.audit(event) VALUES($1)', [data.activityLog[0]]);
    }
    if (revoke) {
      await client.query('UPDATE aftershow_express.admin SET password_hash=$1 WHERE email=$2',[data.admin.passwordHash,data.admin.email]);
      await client.query('DELETE FROM aftershow_express.sessions WHERE email=$1',[data.admin.email]);
    }
    if (session) {
      await client.query('DELETE FROM aftershow_express.sessions WHERE expires<=now()');
      await client.query("INSERT INTO aftershow_express.sessions VALUES($1,$2,$3,now()+interval '24 hours')",[digest(session.token),data.admin.email,session.csrf]);
    }
  });
  invalidateCache();
}
export async function loadConfig() {
  if (cachedData && (Date.now() - cachedDataTime < DATA_CACHE_TTL)) {
    return cachedData.config || {};
  }
  const {rows} = await database().query('SELECT config FROM aftershow_express.settings');
  return rows[0]?.config ?? {};
}
