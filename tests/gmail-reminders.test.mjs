import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const modules=new Map();
function load(path){const url=new URL(path,import.meta.url);if(modules.has(url.href))return modules.get(url.href);const exports={};modules.set(url.href,exports);const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,p=>load(new URL(p,url)));return exports;}
const {createGmailReminderTransport}=load('../supabase/functions/_shared/gmailReminders.ts');
const {createOperationalReminderHandler}=load('../supabase/functions/_shared/operationalReminders.ts');
const env={GMAIL_USER:'team@example.com',GMAIL_APP_PASSWORD:'app-password',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server'};
const mail={kind:'reminder-digest',to:'tester@example.com',ingredients:[{name:'대파',expiryDate:'2026-11-16',daysLeft:3,ingredientId:'ingredient',deliveryId:'delivery'}]};
const key='reminder-digest:10000000-0000-4000-8000-000000000001';

test('Gmail durable ledger deduplicates concurrent sends and survives transport recreation',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync(new URL('../supabase/migrations/202611130001_gmail_reminder_attempts.sql',import.meta.url),'utf8'));
  const fetcher=async(url,init)=>{const args=JSON.parse(init.body);const name=url.endsWith('reserve_email_smtp_attempt')?'reserve_email_smtp_attempt':'accept_email_smtp_attempt';const result=await db.query(`select public.${name}($1,$2) as value`,[args.p_key,args.p_fingerprint]);return Response.json(result.rows[0].value);};
  let sent=0;
  const send=async m=>{sent++;assert.match(m.html,/대파/);assert.match(m.html,/digest=10000000/);return {accepted:[m.to]};};
  const results=await Promise.allSettled([createGmailReminderTransport(env,send,fetcher)(mail,key),createGmailReminderTransport(env,send,fetcher)(mail,key)]);
  assert.ok(results.some(r=>r.status==='fulfilled'));
  assert.equal(sent,1);
  await createGmailReminderTransport(env,send,fetcher)(mail,key);
  assert.equal(sent,1);
  await assert.rejects(()=>createGmailReminderTransport(env,send,fetcher)({...mail,to:'other@example.com'},key),/requires_review/);
  assert.equal(sent,1);
  const access=await db.query("select has_function_privilege('authenticated','public.reserve_email_smtp_attempt(text,text)','EXECUTE') as allowed");
  assert.equal(access.rows[0].allowed,false);
 }finally{await db.close();}
});

test('ambiguous SMTP failure is never retried even after process restart',async()=>{
 let state=null,calls=0;
 const fetcher=async(url)=>{if(url.endsWith('reserve_email_smtp_attempt')){if(state)return Response.json(state);state='reserved';return Response.json('new');}throw new Error('unexpected accept');};
 const send=async()=>{calls++;throw new Error('provider details must not escape');};
 await assert.rejects(()=>createGmailReminderTransport(env,send,fetcher)(mail,key),/^Error: smtp_attempt_requires_review$/);
 await assert.rejects(()=>createGmailReminderTransport(env,send,fetcher)(mail,key),/^Error: smtp_attempt_requires_review$/);
 assert.equal(calls,1);
});

test('database failure before reservation sends nothing; acceptance-record failure never repeats SMTP',async()=>{
 let calls=0,state=null;
 const send=async m=>{calls++;return {accepted:[m.to]};};
 await assert.rejects(()=>createGmailReminderTransport(env,send,async()=>new Response('',{status:503}))(mail,key),/ledger_unavailable/);
 assert.equal(calls,0);
 const fetcher=async(url)=>{if(url.endsWith('reserve_email_smtp_attempt')){if(state)return Response.json(state);state='reserved';return Response.json('new');}return new Response('',{status:503});};
 await assert.rejects(()=>createGmailReminderTransport(env,send,fetcher)(mail,key),/requires_review/);
 await assert.rejects(()=>createGmailReminderTransport(env,send,fetcher)(mail,key),/requires_review/);
 assert.equal(calls,1);
});

test('server-only diagnostics send one mail only to an already verified consenting recipient',async()=>{
 const sent=[];let queries=0,verified=true;
 const handler=createOperationalReminderHandler(env,async(m,k)=>sent.push({m,k}),async(url)=>{queries++;assert.match(url,/email=eq.tester%40example.com/);assert.match(url,/enabled=eq.true/);assert.match(url,/consent_version=eq.email-reminders-v1/);return Response.json(verified?[{user_id:'owner'}]:[]);});
 const body={action:'test',to:'tester@example.com',requestId:'10000000-0000-4000-8000-000000000001'};
 const req=(token,value=body)=>new Request('https://test/worker',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(value)});
 assert.equal((await handler(req('browser-session'))).status,401);
 assert.equal(queries,0);
 assert.equal((await handler(req('server',null))).status,400);
 const response=await handler(req('server'));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{mode:'test',accepted:1,scheduledDispatchChanged:false});
 assert.equal(sent.length,1);
 assert.deepEqual(sent[0].m.ingredients.map(i=>i.daysLeft),[3,1,0]);
 verified=false;
 assert.equal((await handler(req('server'))).status,403);
 assert.equal(sent.length,1);
});

test('scheduler diagnostic uses the same secret authorization without enabling dispatch',async()=>{
 let calls=0;
 const handler=createOperationalReminderHandler({...env,EMAIL_CRON_SECRET:'cron'},async()=>calls++,async()=>Response.json([{user_id:'owner'}]));
 const body=JSON.stringify({action:'test',to:'tester@example.com',requestId:'10000000-0000-4000-8000-000000000002'});
 const response=await handler(new Request('https://test/worker',{method:'POST',headers:{'x-cron-secret':'cron'},body}));
 assert.equal(response.status,200);
 assert.equal((await response.json()).scheduledDispatchChanged,false);
 assert.equal(calls,1);
});

test('automatic dispatch stays off until explicitly enabled and cron secret is configured',async()=>{
 let sends=0;
 const request=new Request('https://test/worker',{method:'POST',headers:{Authorization:'Bearer server'},body:'{}'});
 assert.equal((await createOperationalReminderHandler(env,async()=>sends++)(request)).status,503);
 const handler=createOperationalReminderHandler({...env,EMAIL_CRON_SECRET:'cron'},async()=>sends++,async()=>Response.json(0));
 const result=await handler(new Request('https://test/worker',{method:'POST',headers:{'x-cron-secret':'cron'},body:'{}'}));
 assert.equal((await result.json()).mode,'planning-only');
 assert.equal(sends,0);
});
