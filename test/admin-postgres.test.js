import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import pg from 'pg';

test('admin import, session expiry, CSRF and revocation survive database round trips',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const url=new URL(process.env.TEST_DATABASE_URL);
    assert.equal(url.hostname,'127.0.0.1');
    assert.equal(url.pathname,'/aftershow_test');
    const control=new pg.Client({connectionString:url.href});await control.connect();
    const dbName='admin_test_'+randomBytes(6).toString('hex');
    await control.query(`CREATE DATABASE ${dbName}`);
    url.pathname='/'+dbName;
    process.env.EXPRESS_DATABASE_URL=url.href;
    const dir=await mkdtemp(join(tmpdir(),'aftershow-import-'));
    const file=join(dir,'fixture.json'), salt=randomBytes(32).toString('hex');
    const password=randomBytes(16).toString('hex'), email='fixture@example.invalid';
    const config={customLinks:[{label:'Fixture',url:'https://isaidub.green/'}]};
    const hash=pbkdf2Sync(password,salt,310000,32,'sha256').toString('hex');
    await writeFile(file,JSON.stringify({admin:{email,passwordHash:`pbkdf2$${salt}$${hash}`},config,activityLog:[{action:'fixture'}]}));
    const {database}=await import('../admin-store.js');
    let server;
    t.after(async()=>{
      if(server) await new Promise(done=>server.close(done));
      await database().end();await control.query(`DROP DATABASE ${dbName}`);await control.end();await rm(dir,{recursive:true});
    });
    for(let i=0;i<2;i++)execFileSync(process.execPath,['scripts/import-admin.mjs',file]);
    const {rows:[row]}=await database().query('SELECT config,(SELECT count(*) FROM aftershow_express.audit)::int n FROM aftershow_express.settings');
    assert.deepEqual(row,{config,n:1});
    const {createApp}=await import('../server.js');
    server=createApp().listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}/admin`;
    const request=(path,init={})=>fetch(base+path,{redirect:'manual',...init});
    const login=async()=>{
      const res=await request('/login',{method:'POST',body:new URLSearchParams({email,password})});
      assert.equal(res.status,302);const cookie=res.headers.get('set-cookie');
      assert.match(cookie,/httponly/i);assert.match(cookie,/samesite=strict/i);return cookie.split(';')[0];
    };
    const cookie=await login(),headers={cookie};
    const dash=await request('/dashboard',{headers});assert.equal(dash.status,200);
    const csrf=/name="_csrf" value="([a-f0-9]+)"/.exec(await dash.text())[1];
    const stored=(await database().query('SELECT digest FROM aftershow_express.sessions')).rows[0].digest;
    assert.notEqual(stored,cookie.split('=')[1]);
    assert.equal((await request('/logout',{method:'POST',headers,body:new URLSearchParams()})).status,403);
    assert.equal((await request('/logout',{method:'POST',headers,body:new URLSearchParams({_csrf:csrf})})).status,302);
    assert.equal((await request('/dashboard',{headers})).status,302);
    const second=await login();await database().query("UPDATE aftershow_express.sessions SET expires=now()-interval '1 minute'");
    assert.equal((await request('/dashboard',{headers:{cookie:second}})).status,302);
  });
