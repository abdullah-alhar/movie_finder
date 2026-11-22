try { process.loadEnvFile?.(); } catch {}
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import express                                        from 'express';
import { approved, origins, updateOrigins }                     from './sources.js';

const router    = express.Router();
import { database, digest, loadData, saveData } from './admin-store.js';
import { readHTML } from './providers.js';
/* ─── Password Verification (PBKDF2-SHA256) ───────────────────────────────── */
function hashPassword(plain) {
  const salt = randomBytes(32).toString('hex');
  const hash = pbkdf2Sync(plain, salt, 310_000, 32, 'sha256').toString('hex');
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
  try {
    const [, salt, hash] = stored.split('$');
    const attempt = pbkdf2Sync(plain, salt, 310_000, 32, 'sha256').toString('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch {
    return false;
  }
}

/* ─── Session Management (24 hours) ───────────────────────────────────────── */
const SESSION_TTL = 86_400_000;
const cookie = {httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/admin'};
function tokenOf(req) { return /(?:^|;\s*)af_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; }

const sessionCache = new Map();
async function getSession(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const now = Date.now();
  const cached = sessionCache.get(token);
  if (cached && cached.expires > now) {
    return cached.session;
  }
  try {
    const row = (await database().query('SELECT email,csrf,extract(epoch from expires)*1000 as exp FROM aftershow_express.sessions WHERE digest=$1 AND expires>now()',[digest(token)])).rows[0];
    if (!row) {
      sessionCache.delete(token);
      return null;
    }
    const sess = { email: row.email, csrf: row.csrf };
    sessionCache.set(token, { session: sess, expires: Number(row.exp) });
    return sess;
  } catch (err) {
    console.warn('[admin session lookup warning]', err.message);
    if (cached) return cached.session;
    return null;
  }
}
/* ─── Rate Limiting ───────────────────────────────────────────────────────── */
const attempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now(), rec = attempts.get(ip);
  if (!rec || rec.until < now) {
    attempts.set(ip, { count: 0, until: now + 900_000 });
    return { ok: true };
  }
  if (rec.count >= 5) return { ok: false, mins: Math.ceil((rec.until - now) / 60_000) };
  return { ok: true };
}

function logFailedAttempt(ip) {
  const rec = attempts.get(ip) || { count: 0, until: Date.now() + 900_000 };
  rec.count++;
  attempts.set(ip, rec);
}

/* ─── Activity Logger ─────────────────────────────────────────────────────── */
function logActivity(data, action, who) {
  data.activityLog = [
    { action, who, at: new Date().toISOString() },
    ...(data.activityLog || []),
  ].slice(0, 60);
}

async function requireSession(req, res, next) {
  const sess = await getSession(req);
  if (!sess) return res.redirect('/admin/login');
  req.adminSess = sess;
  next();
}

function checkCsrf(req) {
  const sess = req.adminSess;
  return sess && sess.csrf === req.body?._csrf;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

/* ─── Admin CSS ───────────────────────────────────────────────────────────── */
const CSS = `
<style>
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#0b0b0e;--s1:#111116;--s2:#191920;--s3:#22222b;
  --fg:#f1f0ec;--mu:#8d8b94;--fa:#44434c;
  --ac:#ff6b3d;--ac2:#ff855f;--gr:#22c55e;--rd:#ef4444;--ye:#f59e0b;
  --bo:rgba(255,255,255,.08);--ra:14px;
  font-family:'Inter',system-ui,sans-serif;font-size:14.5px;line-height:1.5;color-scheme:dark
}
body{margin:0;background:var(--bg);color:var(--fg);min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
h1,h2,h3{margin:0;font-family:'Fraunces',Georgia,serif;line-height:1.15}
p{margin:0}a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}
input,select,textarea{font:inherit;color:inherit;background:var(--s2);border:1px solid var(--bo);border-radius:9px;padding:10px 14px;width:100%;outline:none;transition:border-color .15s;box-sizing:border-box}
input:focus,select:focus,textarea:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(255,107,61,0.15)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 20px;border-radius:9px;font:600 14px/1 inherit;border:none;cursor:pointer;transition:all .15s ease;text-decoration:none}
.btn:active{transform:scale(.97)}
.bp{background:var(--ac);color:#fff}.bp:hover{background:var(--ac2);box-shadow:0 4px 16px rgba(255,107,61,.35)}
.bs{background:var(--s2);color:var(--fg);border:1px solid var(--bo)}.bs:hover{background:var(--s3);border-color:rgba(255,255,255,.15)}
.bd{background:rgba(239,68,68,.15);color:#fca5a5;border:1px solid rgba(239,68,68,.3)}.bd:hover{background:var(--rd);color:#fff}
.bgr{background:rgba(34,197,94,.15);color:#86efac;border:1px solid rgba(34,197,94,.3)}.bgr:hover{background:var(--gr);color:#fff}
.bsm{padding:6px 13px;font-size:13px;border-radius:7px}
.card{background:var(--s1);border:1px solid var(--bo);border-radius:var(--ra);padding:24px;margin-bottom:20px;box-shadow:0 8px 30px rgba(0,0,0,0.4)}
.al{padding:12px 16px;border-radius:10px;font-size:13.5px;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.ae{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5}
.as{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#86efac}
.aw{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);color:#fde68a}
label{font-size:12px;font-weight:700;color:var(--mu);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px}
.fi{margin-bottom:18px}
code{background:var(--s3);border-radius:5px;padding:2px 6px;font-size:12.5px;color:var(--ac2);font-family:monospace}
.badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;background:var(--s3);color:var(--mu)}
.badge-green{background:rgba(34,197,94,.15);color:#86efac;border:1px solid rgba(34,197,94,.3)}
.badge-orange{background:rgba(255,107,61,.15);color:var(--ac2);border:1px solid rgba(255,107,61,.3)}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">`;

function navHTML(email, csrf) {
  return `<nav style="position:fixed;top:0;left:0;right:0;height:56px;background:rgba(11,11,14,.96);backdrop-filter:blur(16px);border-bottom:1px solid var(--bo);display:flex;align-items:center;justify-content:space-between;padding:0 28px;z-index:100">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="font-family:'Fraunces',Georgia,serif;font-weight:800;font-size:18px"><span style="color:var(--ac)">After</span>Show Admin</span>
      <span class="badge badge-green">LIVE SYNCED</span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;font-size:13px;color:var(--mu)">
      <a href="/" target="_blank" style="color:var(--fg);display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;background:var(--s2);border:1px solid var(--bo);border-radius:8px">Open Site ↗</a>
      <span>${esc(email)}</span>
      <form method="POST" action="/admin/logout" style="margin:0">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <button class="btn bs bsm" type="submit">Sign out</button>
      </form>
    </div>
  </nav>`;
}

/* ─── Root Redirect ───────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  if (await getSession(req)) return res.redirect('/admin/dashboard');
  res.redirect('/admin/login');
});

// Setup is completely disabled (account is created, only login allowed)
router.get('/setup', async (req, res) => {
  res.redirect('/admin/login');
});
router.post('/setup', async (req, res) => {
  res.redirect('/admin/login');
});

/* ─── Login ───────────────────────────────────────────────────────────────── */
router.get('/login', async (req, res) => {
  if (await getSession(req)) return res.redirect('/admin/dashboard');
  const d = await loadData();
  if (!d.admin) {
    return res.status(403).send(`<!doctype html><html><head>${CSS}</head><body><div class="card" style="max-width:400px"><h2 style="color:var(--rd)">Admin Not Configured</h2><p style="margin-top:8px">Admin database not initialized.</p></div></body></html>`);
  }
  res.set('Content-Type','text/html;charset=utf-8');
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · AfterShow Admin</title>${CSS}</head><body>
  <div style="width:100%;max-width:390px">
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:42px;margin-bottom:10px">🎬</div>
      <h1 style="font-size:28px">AfterShow <span style="color:var(--ac)">Admin</span></h1>
      <p style="color:var(--mu);margin-top:6px;font-size:13.5px">Sign in to manage provider links and scraping engines</p>
    </div>
    <div class="card">
      <form method="POST" action="/admin/login" autocomplete="off">
        <div class="fi">
          <label for="e">Admin Email</label>
          <input id="e" type="email" name="email" required autofocus placeholder="admin@example.com">
        </div>
        <div class="fi">
          <label for="p">Password</label>
          <input id="p" type="password" name="password" required placeholder="Enter your password">
        </div>
        <button class="btn bp" type="submit" style="width:100%;padding:12px;margin-top:4px">Sign in →</button>
      </form>
    </div>
    <p style="text-align:center;color:var(--fa);font-size:11.5px;margin-top:14px">Secured with PBKDF2-SHA256 · Verified against PostgreSQL</p>
  </div></body></html>`);
});

router.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const ip  = req.socket.remoteAddress;
  const rl  = checkRateLimit(ip);
  if (!rl.ok) {
    res.set('Content-Type','text/html;charset=utf-8');
    return res.status(429).send(`<!doctype html><html><head>${CSS}</head><body><div style="max-width:390px;width:100%"><div class="al ae">Too many failed attempts. Try again in ${rl.mins} min${rl.mins!==1?'s':''}.</div><a class="btn bs" href="/admin/login">← Back</a></div></body></html>`);
  }
  const d = await loadData();
  if (!d.admin) return res.status(403).send('Forbidden');
  const em = (req.body.email || '').toLowerCase().trim();
  const pw = req.body.password || '';
  const ok = d.admin.email === em && verifyPassword(pw, d.admin.passwordHash);
  if (!ok) {
    logFailedAttempt(ip);
    res.set('Content-Type','text/html;charset=utf-8');
    return res.status(401).send(`<!doctype html><html><head>${CSS}</head><body><div style="max-width:390px;width:100%"><div class="al ae">Invalid email or password.</div><a class="btn bs" href="/admin/login">← Try again</a></div></body></html>`);
  }
  logActivity(d, 'Admin signed in', em);
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(16).toString("hex");
  await saveData(d,{session:{token,csrf}});
  sessionCache.set(token, { session: { email: em, csrf }, expires: Date.now() + SESSION_TTL });
  res.cookie("af_admin",token,{...cookie,maxAge:SESSION_TTL});
  res.redirect('/admin/dashboard');
});

router.post('/logout', requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  if (!checkCsrf(req)) return res.sendStatus(403);
  const token = tokenOf(req);
  if (token) sessionCache.delete(token);
  await database().query('DELETE FROM aftershow_express.sessions WHERE digest=$1',[digest(token)]);
  res.clearCookie('af_admin',cookie);
  res.redirect('/admin/login');
});

/* ─── API: Test Provider / Custom Link Live ───────────────────────────────── */
router.get('/api/test-link', requireSession, async (req, res) => {
  const target = req.query.url;
  if (!approved(target)) return res.status(400).json({ok:false,error:'Invalid URL. Must be a valid HTTPS address.'});
  const start = Date.now();
  try {
    await readHTML(target, 6000);
    res.json({ok:true,status:200,latencyMs:Date.now()-start});
  } catch (err) {
    res.json({ok:false,error: err.message || 'Provider unavailable'});
  }
});

/* ─── Dashboard ───────────────────────────────────────────────────────────── */
router.get('/dashboard', requireSession, async (req, res) => {
  const d    = await loadData(database(), true);
  const sess = req.adminSess;
  const cfg  = d.config || {};
  const lks  = cfg.customLinks || [];
  const log  = (d.activityLog || []).slice(0, 15);
  const isaidubRunning  = origins.isaidub || 'https://isaidub.green';
  const moviezdaRunning = origins.moviezda || 'https://moviesda36.com';

  res.set('Content-Type','text/html;charset=utf-8');
  res.send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · AfterShow Admin</title>${CSS}
<style>
body{align-items:flex-start;justify-content:flex-start;padding:76px 24px 60px}
.wrap{max-width:920px;width:100%;margin:0 auto}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--bo);margin-bottom:28px}
.tab{padding:11px 20px;font-size:14px;font-weight:600;color:var(--mu);border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.tab.on{color:var(--ac);border-bottom-color:var(--ac)}
.pane{display:none}.pane.on{display:block}
.lr{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--bo)}
.lr:last-child{border-bottom:0}
.lt{flex:1;min-width:0}
.ll{font-size:14px;font-weight:600}
.lu{font-size:12.5px;color:var(--mu);margin-top:2px}
.logr{font-size:13px;padding:8px 0;border-bottom:1px solid var(--bo);display:flex;gap:12px;align-items:center}
.logr:last-child{border-bottom:0}
.provider-box{background:var(--s2);border:1px solid var(--bo);border-radius:12px;padding:18px;margin-bottom:16px}
.provider-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.provider-title{font-size:15px;font-weight:700;color:#fff}
.provider-active-url{font-size:12.5px;color:var(--mu);margin-top:6px;display:flex;align-items:center;gap:6px}
.ping-res{font-size:12px;font-weight:600;margin-top:8px}
.ping-res.ok{color:var(--gr)}.ping-res.fail{color:var(--rd)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:22px}
.stat-card{background:var(--s2);border:1px solid var(--bo);border-radius:10px;padding:16px}
.stat-val{font-size:24px;font-weight:800;color:var(--ac);font-family:'Fraunces',Georgia,serif}
.stat-lbl{font-size:12px;font-weight:600;color:var(--mu);text-transform:uppercase;margin-top:4px}
</style>
</head><body>
${navHTML(sess.email, sess.csrf)}
<div class="wrap">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
    <div>
      <h1 style="font-size:30px;margin-bottom:6px">Admin Dashboard</h1>
      <p style="color:var(--mu);font-size:14px">Manage provider links, dynamic domain routing, and scraping options.</p>
    </div>
    <span class="badge badge-green">LIVE SYSTEM READY</span>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-val">${isaidubRunning.replace('https://','')}</div>
      <div class="stat-lbl">Active Isaidub Source</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">${moviezdaRunning.replace('https://','')}</div>
      <div class="stat-lbl">Active Moviezda Source</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">${lks.length}</div>
      <div class="stat-lbl">Custom Links</div>
    </div>
  </div>

  <div class="tabs">
    <button type="button" class="tab on" data-tab="providers" onclick="switchTab('providers')">Movie Providers</button>
    <button type="button" class="tab" data-tab="links" onclick="switchTab('links')">Custom Links</button>
    <button type="button" class="tab" data-tab="security" onclick="switchTab('security')">Security</button>
    <button type="button" class="tab" data-tab="activity" onclick="switchTab('activity')">Activity Log</button>
  </div>

  <!-- ── Tab 1: Providers ── -->
  <div id="pane-providers" class="pane on" data-pane="providers">
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <h3 style="font-size:18px">Provider Mirror Domains</h3>
          <p style="font-size:13px;color:var(--mu);margin-top:2px">URLs are stored in <code>PostgreSQL</code> and updated dynamically in-memory.</p>
        </div>
      </div>

      <div class="al as">
        <span><strong>Real-time Sync Active:</strong> Changes apply instantly to all live scrapers without requiring a server reboot.</span>
      </div>

      <form method="POST" action="/admin/update-config">
        <input type="hidden" name="_csrf" value="${esc(sess.csrf)}">

        <!-- Isaidub -->
        <div class="provider-box">
          <div class="provider-head">
            <span class="provider-title">Isaidub Domain</span>
            <button type="button" class="btn bs bsm" onclick="testPing('isaidub_input', 'ping_isaidub')">Test Connection</button>
          </div>
          <input id="isaidub_input" type="url" name="isaidub_url" value="${esc(cfg.isaidub_url || isaidubRunning)}" required placeholder="https://isaidub.green">
          <div class="provider-active-url">
            <span>Live Scraper Origin:</span> <code>${esc(isaidubRunning)}</code>
          </div>
          <div id="ping_isaidub" class="ping-res"></div>
        </div>

        <!-- Moviezda -->
        <div class="provider-box">
          <div class="provider-head">
            <span class="provider-title">Moviezda Domain</span>
            <button type="button" class="btn bs bsm" onclick="testPing('moviezda_input', 'ping_moviezda')">Test Connection</button>
          </div>
          <input id="moviezda_input" type="url" name="moviezda_url" value="${esc(cfg.moviezda_url || moviezdaRunning)}" required placeholder="https://moviesda36.com">
          <div class="provider-active-url">
            <span>Live Scraper Origin:</span> <code>${esc(moviezdaRunning)}</code>
          </div>
          <div id="ping_moviezda" class="ping-res"></div>
        </div>

        <button class="btn bp" type="submit" style="padding:12px 24px">Save & Apply URLs Now</button>
      </form>
    </div>
  </div>

  <!-- ── Tab 2: Custom Links ── -->
  <div id="pane-links" class="pane" data-pane="links">
    <div class="card">
      <h3 style="font-size:18px;margin-bottom:14px">Add Direct Movie Link</h3>
      <form method="POST" action="/admin/add-link">
        <input type="hidden" name="_csrf" value="${esc(sess.csrf)}">
        <div class="fi">
          <label>Title / Name</label>
          <input type="text" name="label" required maxlength="120" placeholder="e.g. Leo (2023) Tamil 1080p">
        </div>
        <div class="fi">
          <label>Direct Stream or Download URL</label>
          <input id="custom_link_url" type="url" name="url" required placeholder="https://...">
        </div>
        <div class="fi">
          <label>Notes (Resolution, Audio, Source)</label>
          <input type="text" name="notes" placeholder="e.g. 1080p Original Audio Dual">
        </div>
        <button class="btn bp" type="submit">Add to Database</button>
      </form>
    </div>

    <div class="card">
      <h3 style="font-size:18px;margin-bottom:14px">Saved Links (${lks.length})</h3>
      ${lks.length === 0
        ? `<p style="color:var(--mu);font-size:13.5px">No custom links added yet.</p>`
        : lks.map((l, i) => `
          <div class="lr">
            <div class="lt">
              <div class="ll">${esc(l.label)}</div>
              <div class="lu"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url)}</a></div>
              ${l.notes ? `<div style="font-size:11.5px;color:var(--fa);margin-top:3px">${esc(l.notes)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <a href="${esc(l.url)}" target="_blank" class="btn bs bsm">Open</a>
              <form method="POST" action="/admin/remove-link" style="margin:0">
                <input type="hidden" name="_csrf" value="${esc(sess.csrf)}">
                <input type="hidden" name="index" value="${i}">
                <button class="btn bd bsm" type="submit" onclick="return confirm('Delete this link?')">Delete</button>
              </form>
            </div>
          </div>`).join('')}
    </div>
  </div>

  <!-- ── Tab 3: Security ── -->
  <div id="pane-security" class="pane" data-pane="security">
    <div class="card" style="max-width:540px">
      <h3 style="font-size:18px;margin-bottom:14px">Change Password</h3>
      <form method="POST" action="/admin/change-password" autocomplete="off">
        <input type="hidden" name="_csrf" value="${esc(sess.csrf)}">
        <div class="fi">
          <label>Current Password</label>
          <input type="password" name="current" required placeholder="Your current password">
        </div>
        <div class="fi">
          <label>New Password <span class="badge">min 8 characters</span></label>
          <input type="password" name="newpass" required minlength="8" placeholder="At least 8 characters">
        </div>
        <div class="fi">
          <label>Confirm New Password</label>
          <input type="password" name="confirm" required minlength="8" placeholder="Repeat new password">
        </div>
        <button class="btn bp" type="submit">Update Password</button>
      </form>
    </div>
  </div>

  <!-- ── Tab 4: Activity ── -->
  <div id="pane-activity" class="pane" data-pane="activity">
    <div class="card">
      <h3 style="font-size:18px;margin-bottom:14px">System Audit Trail</h3>
      ${log.length === 0
        ? `<p style="color:var(--mu);font-size:13.5px">No audit entries yet.</p>`
        : log.map(l => `
          <div class="logr">
            <span class="badge badge-orange">${esc(l.action)}</span>
            <span style="color:var(--fg);font-weight:500">${esc(l.who)}</span>
            <span style="color:var(--mu);font-size:12px;margin-left:auto">${new Date(l.at).toLocaleString()}</span>
          </div>`).join('')}
    </div>
  </div>
</div>

<script>
function switchTab(name) {
  if (!name) return;
  var allTabs = ['providers', 'links', 'security', 'activity'];
  for (var i = 0; i < allTabs.length; i++) {
    var key = allTabs[i];
    var isCurrent = (key === name);
    var b = document.querySelector('[data-tab="' + key + '"]');
    var p = document.getElementById('pane-' + key);
    if (b) {
      if (isCurrent) b.classList.add('on');
      else b.classList.remove('on');
    }
    if (p) {
      if (isCurrent) {
        p.classList.add('on');
        p.style.display = 'block';
      } else {
        p.classList.remove('on');
        p.style.display = 'none';
      }
    }
  }
  try {
    history.replaceState(null, '', location.pathname + '#' + name);
  } catch(e) {}
}
window.switchTab = switchTab;

// Event delegation on the tabs container so clicks NEVER fail even before full load
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.tab');
  if (btn && btn.hasAttribute('data-tab')) {
    e.preventDefault();
    window.switchTab(btn.getAttribute('data-tab'));
  }
});

// Sync from hash on page load
(function() {
  var h = (location.hash || '').replace('#', '').trim();
  var alias = { p: 'providers', l: 'links', s: 'security', a: 'activity' };
  var target = alias[h] || h;
  if (['providers', 'links', 'security', 'activity'].indexOf(target) !== -1) {
    window.switchTab(target);
  }
})();

async function testPing(inputId, resultId){
  const el = document.getElementById(inputId);
  const out = document.getElementById(resultId);
  const url = el.value.trim();
  if(!url){ out.textContent = 'Please enter a URL first.'; return; }
  out.className = 'ping-res';
  out.textContent = 'Testing connection to ' + url + '…';
  try {
    const res = await fetch('/admin/api/test-link?url=' + encodeURIComponent(url));
    const data = await res.json();
    if(data.ok){
      out.className = 'ping-res ok';
      out.textContent = 'Connected successfully. HTTP ' + data.status + ' (' + data.latencyMs + 'ms) — Server is reachable.';
    } else {
      out.className = 'ping-res fail';
      out.textContent = 'Failed: ' + (data.error || 'HTTP ' + data.status);
    }
  } catch(e){
    out.className = 'ping-res fail';
    out.textContent = 'Connection failed: ' + e.message;
  }
}
</script>
</body></html>`);
});

/* ─── Actions: Update Config ──────────────────────────────────────────────── */
router.post('/update-config', requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  if (!checkCsrf(req)) return res.status(403).send('Bad CSRF token');
  try {
    const d = await loadData(database(), true);
    d.config = d.config || {};
    let { isaidub_url, moviezda_url } = req.body;
    isaidub_url = (isaidub_url || '').trim();
    moviezda_url = (moviezda_url || '').trim();

    if (isaidub_url && !approved(isaidub_url)) {
      return res.status(400).send('Invalid Isaidub URL. Must be a valid public HTTPS address (e.g. https://isaidub.green).');
    }
    if (moviezda_url && !approved(moviezda_url)) {
      return res.status(400).send('Invalid Moviezda URL. Must be a valid public HTTPS address (e.g. https://moviesda36.com).');
    }

    if (isaidub_url)  d.config.isaidub_url  = new URL(isaidub_url.startsWith('http') ? isaidub_url : 'https://' + isaidub_url).origin;
    if (moviezda_url) d.config.moviezda_url = new URL(moviezda_url.startsWith('http') ? moviezda_url : 'https://' + moviezda_url).origin;

    logActivity(d, 'Provider URLs updated', req.adminSess.email);
    await saveData(d);
    updateOrigins(d.config);
    res.redirect('/admin/dashboard#p');
  } catch (err) {
    console.error('[update-config error]', err);
    res.status(500).send('Failed to update config: ' + err.message);
  }
});

/* ─── Actions: Add Custom Link ────────────────────────────────────────────── */
router.post('/add-link', requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  if (!checkCsrf(req)) return res.status(403).send('Bad CSRF token');
  const d = await loadData();
  d.config = d.config || {};
  d.config.customLinks = d.config.customLinks || [];
  let { label, url, notes } = req.body;
  url = (url || '').trim();

  if (!approved(url)) return res.status(400).send('Invalid Link URL. Must be a valid public HTTPS address.');
  if (typeof label === 'string' && label.trim()) {
    d.config.customLinks.push({
      label: label.slice(0, 120).trim(),
      url:   url.slice(0, 500),
      notes: (notes || '').slice(0, 300).trim(),
      addedAt: new Date().toISOString(),
    });
    logActivity(d, `Link added: ${label}`, req.adminSess.email);
    await saveData(d);
  }
  res.redirect('/admin/dashboard#l');
});

/* ─── Actions: Remove Link ────────────────────────────────────────────────── */
router.post('/remove-link', requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  if (!checkCsrf(req)) return res.status(403).send('Bad CSRF token');
  const d   = await loadData();
  d.config  = d.config || {};
  const idx = Number(req.body.index);
  if (Number.isInteger(idx) && idx >= 0 && idx < (d.config.customLinks || []).length) {
    const [rem] = d.config.customLinks.splice(idx, 1);
    logActivity(d, `Link removed: ${rem?.label}`, req.adminSess.email);
    await saveData(d);
  }
  res.redirect('/admin/dashboard#l');
});

/* ─── Actions: Change Password ────────────────────────────────────────────── */
router.post('/change-password', requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  if (!checkCsrf(req)) return res.status(403).send('Bad CSRF token');
  const d = await loadData();
  const { current, newpass, confirm } = req.body;
  const bail = msg => {
    res.set('Content-Type','text/html;charset=utf-8');
    return res.status(400).send(`<!doctype html><html><head>${CSS}</head><body><div style="max-width:400px;width:100%"><div class="al ae">${esc(msg)}</div><a class="btn bs" href="/admin/dashboard#s">← Back</a></div></body></html>`);
  };

  if (!verifyPassword(current || '', d.admin.passwordHash)) {
    return bail('Current password does not match.');
  }
  if (!newpass || newpass.length < 8 || newpass !== confirm) {
    return bail('New password must match confirmation and be at least 8 characters.');
  }

  d.admin.passwordHash = hashPassword(newpass);
  logActivity(d, 'Password updated', req.adminSess.email);
  await saveData(d,{revoke:true});
  res.clearCookie("af_admin",cookie); // force re-login everywhere with new password
  res.redirect('/admin/login');
});

/* ─── Admin Router Error Handler ──────────────────────────────────────────── */
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[admin router error]', err);
  res.status(500).type('html').send(`<!doctype html><html><head>${CSS}</head><body>
    <div class="card" style="max-width:440px;width:100%">
      <h2 style="color:var(--rd)">Admin Error</h2>
      <p style="margin-top:10px;color:var(--mu);font-size:14px">${esc(err.message || 'Database error occurred')}</p>
      <div style="margin-top:18px;display:flex;gap:10px">
        <a class="btn bp" href="/admin/dashboard">Retry Dashboard</a>
        <a class="btn bs" href="/admin/login">Login</a>
      </div>
    </div>
  </body></html>`);
});

export default router;
