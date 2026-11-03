import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const modules=new Map();
function load(path){const url=new URL(path,import.meta.url);if(modules.has(url.href))return modules.get(url.href);const exports={};modules.set(url.href,exports);const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,p=>load(new URL(p,url)));return exports;}
const {createVerificationHandler,createReminderWorker,hashVerification,validEmail}=load('../supabase/functions/_shared/emailNotifications.ts');
const {createGmailVerificationTransport}=load('../supabase/functions/_shared/gmail.ts');
const {createManualReminderTest}=load('../supabase/functions/_shared/manualReminderTest.ts');

test('self-test authenticates each account before scoped queries; never sends when disabled',async()=>{
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server',EMAIL_MANUAL_TEST_ENABLED:'true',EMAIL_MANUAL_TEST_USER_IDS:'tester',EMAIL_CRON_SECRET:'cron'};
 const request=(action,auth=true)=>new Request('https://test/functions/test',{method:'POST',headers:{Origin:'http://127.0.0.1:5173',...(auth?{Authorization:'Bearer session'}:{})},body:JSON.stringify({action})});
 const calls=[];let anonymous=false,id='tester';
 const fetcher=async url=>{calls.push(url);return Response.json(url.includes('/auth/')?{id,is_anonymous:anonymous}:url.endsWith('inspect_email_notification_targets_for_user')?[]:0);};
 const handler=createManualReminderTest(env,null,fetcher);
 assert.equal((await handler(request('run',false))).status,401);assert.equal(calls.length,0);
 id='other';assert.equal((await handler(request('status'))).status,200);assert.ok(calls.every(url=>url.includes('/auth/')));
 id='tester';anonymous=true;assert.equal((await handler(request('status'))).status,200);
 anonymous=false;calls.length=0;assert.equal((await handler(request('run'))).status,503);assert.equal(calls.length,1);
 const inspection=await (await handler(request('inspect'))).json();assert.equal(inspection.sendingReady,false);assert.deepEqual(inspection.users,[]);
 assert.ok(!calls.some(url=>url.includes('claim_email')));
 const off=createManualReminderTest({...env,EMAIL_MANUAL_TEST_ENABLED:'false'},null,fetcher);calls.length=0;
 assert.equal((await off(request('status'))).status,403);assert.equal(calls.length,0);
});

test('manual entry uses the same worker ledger, recheck and stable idempotency key',async()=>{
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server',EMAIL_MANUAL_TEST_ENABLED:'true',EMAIL_MANUAL_TEST_USER_IDS:'tester',EMAIL_CRON_SECRET:'cron',EMAIL_DISPATCH_ENABLED:'true'};
 const calls=[],sent=[];
 const fetcher=async url=>{calls.push(url);return Response.json(url.includes('/auth/')?{id:'tester',is_anonymous:false}:url.endsWith('claim_email_manual_test_run_for_user')?true:url.endsWith('claim_email_digest_deliveries')?[{id:'delivery',user_id:'tester',digest_id:'digest',lease_token:'lease'}]:url.endsWith('prepare_email_digest')?{email:'owner@example.com',userId:'tester',ingredients:[{name:'두부',expiryDate:'2026-11-03',ingredientId:'ingredient',deliveryId:'delivery',daysLeft:3}]}:1);};
 const handler=createManualReminderTest(env,async(mail,key)=>sent.push({mail,key}),fetcher);
 const result=await(await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer session'},body:'{"action":"run"}'}))).json();
 assert.equal(result.sent,1);assert.equal(result.users.tester.sent,1);assert.equal(sent[0].key,'reminder-digest:digest');assert.equal(sent[0].mail.to,'owner@example.com');
 assert.ok(calls.some(url=>url.endsWith('prepare_email_digest')));assert.ok(calls.some(url=>url.endsWith('finish_email_digest')));
 assert.ok(!JSON.stringify(result).includes('owner@example.com'));
});
test('self-test never accepts a client supplied account or recipient and binds all RPCs to Auth user',async()=>{
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server',EMAIL_MANUAL_TEST_ENABLED:'true'};
 const calls=[];
 const handler=createManualReminderTest(env,null,async(url,options)=>{
  if(url.includes('/auth/'))return Response.json({id:'account-a',is_anonymous:false});
  calls.push({url,body:JSON.parse(options.body)});return Response.json(url.includes('inspect_')?[]:0);
 });
 const request=body=>new Request('https://test',{method:'POST',headers:{Authorization:'Bearer a'},body:JSON.stringify(body)});
 assert.equal((await handler(request({action:'run',user_id:'account-b'}))).status,400);
 assert.equal((await handler(request({action:'run',to:'other@example.com'}))).status,400);
 assert.equal(calls.length,0);
 assert.equal((await handler(request({action:'inspect'}))).status,200);
 assert.ok(calls.every(call=>call.body.p_user_id==='account-a'&&call.url.includes('_for_user')));
});

test('Gmail transport: server OAuth, UTF-8 MIME, token reuse and no reminder dispatch',async()=>{
 const env={GMAIL_CLIENT_ID:'test-client',GMAIL_CLIENT_SECRET:'test-secret',GMAIL_REFRESH_TOKEN:'test-refresh',GMAIL_SENDER_EMAIL:'team@example.com'};
 assert.equal(createGmailVerificationTransport({}),null);
 const requests=[];
 const transport=createGmailVerificationTransport(env,async(url,options)=>{
  requests.push({url,options});
  return Response.json(url.includes('oauth2')?{access_token:'test-access',expires_in:3600}:{id:'mail-id'});
 });
 await transport({kind:'verification',to:'tester@example.com',code:'123456'},'request-1');
 await transport({kind:'verification',to:'tester@example.com',code:'654321'},'request-2');
 assert.equal(requests.length,3);
 assert.equal(requests[0].options.body.get('grant_type'),'refresh_token');
 assert.equal(requests[0].options.body.get('refresh_token'),'test-refresh');
 const raw=JSON.parse(requests[1].options.body).raw;
 assert.match(raw,/^[A-Za-z0-9_-]+$/);
 const mime=Buffer.from(raw,'base64url').toString('utf8');
 assert.match(mime,/To: tester@example.com\r\n/);
 assert.match(mime,/Subject: =\?UTF-8\?B\?/);
 assert.match(Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString('utf8'),/인증번호는 123456/);
 assert.equal(requests[1].options.headers.Authorization,'Bearer test-access');
 await assert.rejects(()=>transport({kind:'verification',to:'bad\r\nBcc: victim@example.com',code:'123456'},'bad'),/invalid_verification_mail/);
 await assert.rejects(()=>transport({kind:'reminder'},'reminder'),/not_enabled/);
 assert.equal(requests.length,3);
});
test('Gmail transport hides upstream secrets and never retries a failed send',async()=>{
 const env={GMAIL_CLIENT_ID:'test-client',GMAIL_CLIENT_SECRET:'test-secret',GMAIL_REFRESH_TOKEN:'test-refresh',GMAIL_SENDER_EMAIL:'team@example.com'};
 let calls=0;
 const transport=createGmailVerificationTransport(env,async(url)=>{
  calls++;return url.includes('oauth2')?Response.json({access_token:'test-access',expires_in:3600}):Response.json({error:'private-provider-data'},{status:429});
 });
 await assert.rejects(()=>transport({kind:'verification',to:'tester@example.com',code:'123456'},'request'),/^Error: gmail_send_failed$/);
 assert.equal(calls,2);
});
const db=new PGlite();
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const ingredient='20000000-0000-4000-8000-000000000001',reqid='30000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64);
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 for(const file of ['202610240001_ingredient_storage.sql','202610240002_cloud_snapshot.sql','202610240003_api_budget.sql','202610240004_revision_validation.sql','202610290001_email_foundation.sql','202610310001_email_settings_transfer.sql','202610310002_manual_reminder_test.sql','202610310003_self_reminder_test.sql','202611030001_email_digests.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1),($2)',[a,b]);
});
after(()=>db.close());
async function asUser(id,fn){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn();}finally{await db.exec('reset role');}}
test('migration compiles; direct browser writes/hash reads and service RPC access are blocked',async()=>{
 await asUser(a,async()=>{
  await assert.rejects(()=>db.query('insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,$2,now(),true,now(),$3)',[a,'forged@example.com','email-reminders-v1']),/permission denied/);
  await assert.rejects(()=>db.query('select token_hash from public.email_change_requests'),/permission denied/);
  await assert.rejects(()=>db.query('select public.refresh_email_notification_schedule()'),/permission denied/);
  await assert.rejects(()=>db.query('select public.verify_email_change_request($1,$2,$3)',[a,reqid,hash]),/permission denied/);
 });
});
test('email challenge: old address survives mismatch, wrong owner, expiry and unsent; success is one-time',async()=>{
 await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,'old@example.com',now(),true,now(),'email-reminders-v1')",[a]);
 await db.query('select public.create_email_change_request($1,$2,$3,$4)',[a,reqid,'new@example.com',hash]);
 const verify=async(owner=a,h=hash)=>(await db.query('select public.verify_email_change_request($1,$2,$3) as result',[owner,reqid,h])).rows[0].result;
 assert.equal((await verify()).ok,false);
 await db.query("update public.email_change_requests set delivery_status='sent' where id=$1",[reqid]);
 assert.equal((await verify(b)).ok,false);assert.equal((await verify(a,'b'.repeat(64))).reason,'mismatch');
 assert.equal((await db.query('select email from public.email_notification_settings where user_id=$1',[a])).rows[0].email,'old@example.com');
 await db.query("update public.email_change_requests set expires_at=now()-interval '1 second' where id=$1",[reqid]);assert.equal((await verify()).reason,'expired');
 await db.query("update public.email_change_requests set expires_at=now()+interval '1 minute' where id=$1",[reqid]);assert.equal((await verify()).ok,true);assert.equal((await verify()).ok,false);
 assert.equal((await db.query('select email from public.email_notification_settings where user_id=$1',[a])).rows[0].email,'new@example.com');
 await asUser(b,async()=>assert.equal((await db.query('select * from public.email_notification_settings')).rows.length,0));
});
test('wrong codes stop after five attempts; cooldown is database-enforced',async()=>{
 await db.query("update public.email_change_requests set created_at=now()-interval '2 minutes' where user_id=$1",[a]);
 const id='30000000-0000-4000-8000-000000000002';
 await db.query('select public.create_email_change_request($1,$2,$3,$4)',[a,id,'another@example.com',hash]);
 await assert.rejects(()=>db.query('select public.create_email_change_request($1,$2,$3,$4)',[a,crypto.randomUUID(),'another@example.com',hash]),/resend_cooldown/);
 await db.query("update public.email_change_requests set delivery_status='sent' where id=$1",[id]);
 for(let i=0;i<5;i++)assert.equal((await db.query('select public.verify_email_change_request($1,$2,$3) as r',[a,id,'b'.repeat(64)])).rows[0].r.reason,'mismatch');
 assert.equal((await db.query('select public.verify_email_change_request($1,$2,$3) as r',[a,id,hash])).rows[0].r.reason,'locked');
});
test('KST D-3/D-1/day scheduling is unique; changed date, deletion and opt-out cancel jobs',async()=>{
 await db.query(`insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,'양파','채소',(now() at time zone 'Asia/Seoul')::date+3,jsonb_build_object('id',$1::text,'name','양파','category','채소'))`,[ingredient,a]);
 await db.query('select public.refresh_email_notification_schedule()');await db.query('select public.refresh_email_notification_schedule()');
 let rows=(await db.query('select * from public.email_notification_deliveries where user_id=$1',[a])).rows;assert.equal(rows.length,3);
 assert.equal(new Date(rows.find(r=>r.reminder_type==='3_days').scheduled_at).getUTCHours(),0);
 await db.query("update public.ingredients set expiry_date=expiry_date+1 where user_id=$1",[a]);await db.query('select public.refresh_email_notification_schedule()');
 assert.equal((await db.query("select count(*)::int as n from public.email_notification_deliveries where status='cancelled'")).rows[0].n,3);
 await asUser(a,()=>db.query('select public.set_email_reminders_enabled(false)'));
 assert.equal((await db.query("select count(*)::int as n from public.email_notification_deliveries where status in ('pending','processing','failed')")).rows[0].n,0);
 await asUser(a,()=>db.query('select public.set_email_reminders_enabled(true)'));await db.query('select public.refresh_email_notification_schedule()');
 await db.query('delete from public.ingredients where user_id=$1',[a]);await db.query('select public.refresh_email_notification_schedule()');
 assert.equal((await db.query("select count(*)::int as n from public.email_notification_deliveries where status='pending'")).rows[0].n,0);
});
test('UT events require active consent, idempotency and delivery ownership',async()=>{
 const key=crypto.randomUUID();
 await asUser(a,async()=>{
  assert.equal((await db.query("select public.record_ut_event($1,'app_open') as ok",[key])).rows[0].ok,false);
  await db.query('select public.set_ut_participation(true)');
  for(let i=0;i<2;i++)assert.equal((await db.query("select public.record_ut_event($1,'app_open') as ok",[key])).rows[0].ok,true);
  assert.equal((await db.query('select count(*)::int as n from public.ut_events')).rows[0].n,1);
  assert.equal((await db.query("select public.record_ut_event($1,'notification_click',null,$2) as ok",[crypto.randomUUID(),crypto.randomUUID()])).rows[0].ok,false);
  await db.query('select public.set_ut_participation(false)');assert.equal((await db.query("select public.record_ut_event($1,'app_open') as ok",[crypto.randomUUID()])).rows[0].ok,false);
 });
});
test('queue leases prevent duplicate claims, retries stop at three, and eligibility is checked before send',async()=>{
 const item='20000000-0000-4000-8000-000000000002';
 await db.query(`insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,'두부','두부·콩류',(now() at time zone 'Asia/Seoul')::date+3,jsonb_build_object('id',$1::text,'name','두부','category','두부·콩류'))`,[item,a]);
 await db.query('select public.refresh_email_notification_schedule()');
 await db.query("update public.email_notification_deliveries set scheduled_at=now()-interval '1 second' where ingredient_id=$1 and reminder_type='3_days'",[item]);
 const claim=async()=>(await db.query('select * from public.claim_email_deliveries()')).rows;
 for(let attempt=1;attempt<=3;attempt++){
  const rows=await claim();assert.equal(rows.length,1);const job=rows[0];assert.equal(job.attempt_count,attempt);
  assert.equal((await claim()).length,0);
  const current=(await db.query('select public.prepare_email_delivery($1,$2) as data',[job.id,job.lease_token])).rows[0].data;assert.equal(current.email,'new@example.com');
  await db.query('select public.finish_email_delivery($1,$2,false)',[job.id,job.lease_token]);
  await db.query("update public.email_notification_deliveries set next_attempt_at=now()-interval '1 second' where id=$1",[job.id]);
 }
 assert.equal((await claim()).length,0);
 await db.query('delete from public.ingredients where id=$1',[item]);
 await db.query('select public.refresh_email_notification_schedule()');
});

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'PRIVATE',EMAIL_VERIFICATION_PEPPER:'PRIVATE-PEPPER',EMAIL_CRON_SECRET:'PRIVATE-CRON'};
const request=body=>new Request('https://x',{method:'POST',headers:{Authorization:'Bearer user-token',Origin:'http://localhost:5174'},body:JSON.stringify(body)});
test('verification validates user and never claims sent/verified without provider; no keys leak',async()=>{
 let calls=0;const handler=createVerificationHandler(env,null,async()=>{calls++;return Response.json({id:a})});
 assert.equal((await handler(new Request('https://x',{method:'POST'}))).status,401);
 const response=await handler(request({action:'request-code',email:'tester@example.com',consent:true,consentVersion:'email-reminders-v1'}));
 assert.equal(response.status,503);assert.equal(calls,1);assert.doesNotMatch(await response.text(),/PRIVATE|user-token/);
 assert.equal((await handler(request({action:'request-code',email:'bad@',consent:true,consentVersion:'email-reminders-v1'}))).status,400);
 assert.equal(validEmail('a@example.com\r\nBcc:spam'),false);
 assert.notEqual(await hashVerification(a,reqid,'123456','pepper'),await hashVerification(b,reqid,'123456','pepper'));
});
test('server generates and hashes code, derives owner, sends then marks sent; response contains no code',async()=>{
 const calls=[];let mail;
 const handler=createVerificationHandler(env,async m=>{mail=m;},async(url,init)=>{
  calls.push({url,body:init?.body&&JSON.parse(init.body)});
  if(url.endsWith('/user'))return Response.json({id:a});
  if(url.endsWith('create_email_change_request'))return Response.json(new Date(Date.now()+300000).toISOString());
  return new Response(null,{status:204});
 });
 const response=await handler(request({action:'request-code',user_id:b,email:'tester@example.com',consent:true,consentVersion:'email-reminders-v1'}));
 const result=await response.json();assert.equal(response.status,200);assert.match(mail.code,/^\d{6}$/);assert.equal(result.code,undefined);
 const create=calls.find(c=>c.url.endsWith('create_email_change_request'));assert.equal(create.body.p_user_id,a);assert.equal(create.body.p_hash.length,64);assert.notEqual(create.body.p_hash,mail.code);
 assert.equal(calls.at(-1).body.delivery_status,'sent');
});
test('worker rejects browser token; planning-only never claims or marks sent; dispatch rechecks eligibility',async()=>{
 let calls=[];
 const fetcher=async(url)=>{calls.push(url);return Response.json(3);};
 const worker=createReminderWorker(env,null,fetcher);
 assert.equal((await worker(request({}))).status,401);assert.equal(calls.length,0);
 const cron=()=>new Request('https://x',{method:'POST',headers:{'x-cron-secret':env.EMAIL_CRON_SECRET}});
 assert.deepEqual(await (await worker(cron())).json(),{mode:'planning-only',planned:3,sent:0});assert.equal(calls.length,1);
 let sent=0;calls=[];
 const active=createReminderWorker({...env,EMAIL_DISPATCH_ENABLED:'true'},async()=>{sent++;},async url=>{
  calls.push(url);return Response.json(url.endsWith('claim_email_digest_deliveries')?[{id:reqid,digest_id:'digest',user_id:'owner',lease_token:'lease'}]:url.endsWith('prepare_email_digest')?null:0);
 });
 const result=await (await active(cron())).json();assert.equal(sent,0);assert.equal(result.cancelled,1);assert.equal(calls.some(u=>u.endsWith('finish_email_delivery')),false);
});
test('Resend transport stays off without secrets and sends the rendered reminder with the idempotency key',async()=>{
 const {createResendTransport}=load('../supabase/functions/_shared/emailTransport.ts');
 assert.equal(createResendTransport({RESEND_API_KEY:'k'}),null);
 const calls=[];
 const transport=createResendTransport({RESEND_API_KEY:'k',EMAIL_FROM:'콕집서 <a@example.com>'},async(url,init)=>{calls.push({url,init});return new Response('{}');});
 await transport({kind:'reminder',to:'tester@example.com',name:'두부',expiryDate:'2026-11-03',ingredientId:ingredient,deliveryId:reqid,reminderType:'3_days'},'reminder:x');
 const body=JSON.parse(calls[0].init.body);
 assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].init.headers['Idempotency-Key'],'reminder:x');
 assert.deepEqual(body.to,['tester@example.com']);assert.match(body.html,/두부/);assert.equal(body.subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');
 await transport({kind:'reminder',to:'tester@example.com',name:'두부',expiryDate:'2026-11-03',ingredientId:ingredient,deliveryId:reqid,reminderType:'1_day'},'reminder:y');
 assert.equal(JSON.parse(calls[1].init.body).subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');
 await transport({kind:'reminder',to:'tester@example.com',name:'두부',expiryDate:'2026-11-03',ingredientId:ingredient,deliveryId:reqid,reminderType:'due_today'},'reminder:z');
 const today=JSON.parse(calls[2].init.body);assert.equal(today.subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');assert.match(today.text,/D-Day/);assert.doesNotMatch(today.html,/3일 남은/);
 const failing=createResendTransport({RESEND_API_KEY:'k',EMAIL_FROM:'a@example.com'},async()=>new Response('{}',{status:422}));
 await assert.rejects(()=>failing({kind:'reminder',to:'t@example.com',name:'x',expiryDate:'2026-11-03',ingredientId:ingredient,deliveryId:reqid,reminderType:'3_days'},'k'),/provider_422/);
});
test('reminder mail carries each user own address, ingredient name and expiry date',async()=>{
 const users=[['40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','user-c@example.com','청송사과',1],['40000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','user-d@example.com','시금치',0]];
 for(const [user,item,email,name,days] of users){
  await db.query('insert into auth.users values($1)',[user]);
  await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,$2,now(),true,now(),'email-reminders-v1')",[user,email]);
  await db.query(`insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,$3,'과일',(now() at time zone 'Asia/Seoul')::date+$4::int,jsonb_build_object('id',$1::text,'name',$3::text,'category','과일'))`,[item,user,name,days]);
 }
 // 오늘 23:59 KST 기준으로 꺼내 시각과 무관하게 오늘 슬롯만 대상으로 만든다.
 const endOfToday="((now() at time zone 'Asia/Seoul')::date+time '23:59') at time zone 'Asia/Seoul'";
 await db.query(`select public.refresh_email_notification_schedule(${endOfToday})`);
 const {rows:jobs}=await db.query(`select id,lease_token from public.claim_email_deliveries(${endOfToday}) where user_id in ($1,$2)`,users.map(u=>u[0]));
 assert.equal(jobs.length,2);
 await db.query("update public.email_notification_deliveries set lease_until=now()+interval '5 minutes' where id=any($1)",[jobs.map(j=>j.id)]);
 const {createResendTransport}=load('../supabase/functions/_shared/emailTransport.ts');
 const sent=[];const transport=createResendTransport({RESEND_API_KEY:'k',EMAIL_FROM:'a@example.com'},async(url,init)=>{sent.push(JSON.parse(init.body));return new Response('{}');});
 for(const job of jobs){const {rows:[{mail}]}=await db.query('select public.prepare_email_delivery($1,$2) as mail',[job.id,job.lease_token]);await transport({kind:'reminder',to:mail.email,...mail},`reminder:${job.id}`);}
 const today=(await db.query("select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') as d")).rows[0].d;
 const tomorrow=(await db.query("select to_char((now() at time zone 'Asia/Seoul')::date+1,'YYYY-MM-DD') as d")).rows[0].d;
 const c=sent.find(m=>m.to[0]==='user-c@example.com'),d=sent.find(m=>m.to[0]==='user-d@example.com');
 assert.match(c.html,/청송사과/);assert.match(c.html,new RegExp(`${tomorrow}까지`));assert.equal(c.subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');assert.doesNotMatch(c.html,/시금치/);
 assert.match(d.html,/시금치/);assert.match(d.html,new RegExp(`${today}까지`));assert.equal(d.subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');assert.doesNotMatch(d.html,/청송사과/);
});

test('email settings move from the temporary account to an already-linked Google account with a one-time ticket',async()=>{
 const temp='10000000-0000-4000-8000-000000000003',google='10000000-0000-4000-8000-000000000004',other='10000000-0000-4000-8000-000000000005';
 await db.query('insert into auth.users values($1),($2),($3)',[temp,google,other]);
 assert.equal(await asUser(google,async()=>(await db.query('select public.start_email_settings_transfer() as t')).rows[0].t),null,'no verified email, no ticket');
 await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,'temp@example.com',now(),true,now(),'email-reminders-v1')",[temp]);
 const token=await asUser(temp,async()=>{
  await assert.rejects(()=>db.query('select * from public.email_settings_transfers'),/permission denied/);
  return (await db.query('select public.start_email_settings_transfer() as t')).rows[0].t;
 });
 assert.match(token,/^[0-9a-f]{64}$/);
 assert.equal((await db.query('select count(*)::int as n from public.email_settings_transfers where token_hash=$1',[token])).rows[0].n,0,'only the hash is stored');
 const claim=(owner,t)=>asUser(owner,async()=>(await db.query('select public.claim_email_settings_transfer($1) as ok',[t])).rows[0].ok);
 assert.equal(await claim(google,'f'.repeat(64)),false);
 assert.equal(await claim(google,token),true);
 const rows=(await db.query('select user_id,email,enabled from public.email_notification_settings where user_id in ($1,$2) order by email',[temp,google])).rows;
 assert.deepEqual(rows.map(r=>[r.user_id,r.email,r.enabled]),[[temp,'temp@example.com',false],[google,'temp@example.com',true]]);
 assert.equal(await claim(other,token),false,'one-time');
 await db.query("update public.email_notification_settings set enabled=true where user_id=$1",[temp]);
 const second=await asUser(temp,async()=>(await db.query('select public.start_email_settings_transfer() as t')).rows[0].t);
 await db.query("update public.email_notification_settings set email='mine@example.com' where user_id=$1",[google]);
 assert.equal(await claim(google,second),false,'an existing verified email is never overwritten');
 assert.equal((await db.query('select email from public.email_notification_settings where user_id=$1',[google])).rows[0].email,'mine@example.com');
 const expired=await asUser(temp,async()=>(await db.query('select public.start_email_settings_transfer() as t')).rows[0].t);
 await db.query("update public.email_settings_transfers set expires_at=now()-interval '1 second' where claimed_at is null");
 assert.equal(await claim(other,expired),false);
});

test('manual database scan selects A=2 B=1 C=0 D=0; ignores clock only, not consent or sent ledger',async()=>{
 await asUser(a,()=>assert.rejects(()=>db.query('select public.claim_email_deliveries_now()'),/permission denied/));
 await db.exec('begin');
 try{
  const owners=[];
  for(let u=1;u<=6;u++){
   const owner='90000000-0000-4000-8000-'+String(u).padStart(12,'0');owners.push(owner);
   await db.query('insert into auth.users values($1)',[owner]);
   if(u!==6)await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,$2,now(),$3,now(),'email-reminders-v1')",[owner,'user'+u+'@example.com',u!==5]);
   const size=[20,10,5,1,1,1][u-1];
   for(let i=0;i<size;i++){
    const offset=u===1&&i<2?[3,1][i]:u===2&&i===0?0:u===4?-1:u>=5?1:10;
    await db.query("insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,$3,'채소',(now() at time zone 'Asia/Seoul')::date+$4::int,jsonb_build_object('id',$1::text,'name',$3::text,'category','채소'))",[crypto.randomUUID(),owner,'재료'+i,offset]);
   }
  }
  await db.query('select public.refresh_email_notification_schedule()');
  const summaries=(await db.query('select public.inspect_email_notification_targets() as rows')).rows[0].rows;
  assert.deepEqual(owners.map(owner=>summaries.find(row=>row.user_id===owner).eligible),[2,1,0,0,0,0]);
  assert.equal(summaries.find(row=>row.user_id===owners[3]).expired,1);
  await db.query("update public.email_notification_deliveries set scheduled_at=((now() at time zone 'Asia/Seoul')::date+time '23:59:59') at time zone 'Asia/Seoul' where user_id=any($1::uuid[]) and (scheduled_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date",[owners]);
  const normal=(await db.query('select * from public.claim_email_deliveries()')).rows;
  assert.equal(normal.filter(row=>owners.includes(row.user_id)).length,0);
  const jobs=(await db.query('select * from public.claim_email_deliveries_now()')).rows.filter(row=>owners.includes(row.user_id));
  assert.equal(jobs.length,3);
  for(const job of jobs){
   const mail=(await db.query('select public.prepare_email_delivery($1,$2) as mail',[job.id,job.lease_token])).rows[0].mail;
   assert.equal(mail.email,'user'+(owners.indexOf(job.user_id)+1)+'@example.com');
   await db.query('select public.finish_email_delivery($1,$2,true)',[job.id,job.lease_token]);
  }
  const again=(await db.query('select * from public.claim_email_deliveries_now()')).rows;
  assert.equal(again.filter(row=>owners.includes(row.user_id)).length,0);
  assert.equal((await db.query('select public.claim_email_manual_test_run() as ok')).rows[0].ok,true);
  assert.equal((await db.query('select public.claim_email_manual_test_run() as ok')).rows[0].ok,false);
 }finally{await db.exec('rollback');}
});

test('self-test DB schedules, inspects, claims and rate limits only the requested owner',async()=>{
 await db.exec('begin');
 try{
  const owners=['a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002'];
  for(const owner of owners){
   await db.query('insert into auth.users values($1)',[owner]);
   await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,$2,now(),true,now(),'email-reminders-v1')",[owner,owner.slice(0,8)+'@example.com']);
   const id=crypto.randomUUID();await db.query("insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,'양파','채소',(now() at time zone 'Asia/Seoul')::date+1,jsonb_build_object('id',$1::text,'name','양파','category','채소'))",[id,owner]);
  }
  const [a,b]=owners;
  await db.query('select public.refresh_email_notification_schedule_for_user($1)',[a]);
  assert.equal((await db.query('select count(*)::int as n from public.email_notification_deliveries where user_id=$1',[b])).rows[0].n,0);
  await db.query('select public.refresh_email_notification_schedule_for_user($1)',[b]);
  const report=(await db.query('select public.inspect_email_notification_targets_for_user($1) as report',[a])).rows[0].report;
  assert.deepEqual(report.map(row=>row.user_id),[a]);assert.equal(report[0].eligible,1);
  const jobs=(await db.query('select * from public.claim_email_deliveries_for_user_now($1)',[a])).rows;
  assert.equal(jobs.length,1);assert.equal(jobs[0].user_id,a);
  assert.equal((await db.query("select count(*)::int as n from public.email_notification_deliveries where user_id=$1 and status='processing'",[b])).rows[0].n,0);
  assert.equal((await db.query('select public.claim_email_manual_test_run_for_user($1) as ok',[a])).rows[0].ok,true);
  assert.equal((await db.query('select public.claim_email_manual_test_run_for_user($1) as ok',[a])).rows[0].ok,false);
  assert.equal((await db.query('select public.claim_email_manual_test_run_for_user($1) as ok',[b])).rows[0].ok,true);
  assert.equal((await db.query("select has_function_privilege('service_role','public.claim_email_deliveries_now()','execute') as ok")).rows[0].ok,false);
 }finally{await db.exec('rollback');}
});

test('digests combine all deadlines for one owner, remain stable after a crash, and finish atomically',async()=>{
 await db.exec('begin');try{
  const owner='b1000000-0000-4000-8000-000000000001';await db.query('insert into auth.users values($1)',[owner]);
  await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,'digest@example.com',now(),true,now(),'email-reminders-v1')",[owner]);
  for(const [name,days] of [['두부',0],['대파',1],['우유',1],['양배추',3],['대상 아님',5]]){
   const id=crypto.randomUUID();await db.query("insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,$3,'채소',(now() at time zone 'Asia/Seoul')::date+$4::int,jsonb_build_object('id',$1::text,'name',$3::text,'category','채소'))",[id,owner,name,days]);
  }
  await db.query('select public.refresh_email_notification_schedule_for_user($1)',[owner]);
  const first=(await db.query('select * from public.claim_email_digest_deliveries($1,true)',[owner])).rows;
  assert.equal(first.length,4);assert.equal(new Set(first.map(row=>row.digest_id)).size,1);
  let mail=(await db.query('select public.prepare_email_digest($1,$2) as mail',[first[0].digest_id,first[0].lease_token])).rows[0].mail;
  assert.equal(mail.email,'digest@example.com');assert.deepEqual(mail.ingredients.map(item=>item.daysLeft),[0,1,1,3]);
  const rendered=load('../supabase/functions/_shared/emailTemplates.ts').renderReminderEmail({to:mail.email,ingredients:mail.ingredients});
  assert.equal(rendered.subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');assert.match(rendered.html,/총 4개/);assert.doesNotMatch(rendered.html,/대상 아님/);
  assert.ok(rendered.html.indexOf('D-Day')<rendered.html.indexOf('D-1'));assert.ok(rendered.html.indexOf('D-1')<rendered.html.indexOf('D-3'));
  await db.query("update public.email_notification_deliveries set lease_until=now()-interval '1 minute' where user_id=$1",[owner]);
  const retry=(await db.query('select * from public.claim_email_digest_deliveries($1,true)',[owner])).rows;
  assert.equal(retry.length,4);assert.ok(retry.every(row=>row.digest_id===first[0].digest_id));
  await db.query('select public.finish_email_digest($1,$2,true)',[retry[0].digest_id,retry[0].lease_token]);
  assert.equal((await db.query("select count(*)::int as n from public.email_notification_deliveries where user_id=$1 and status='sent'",[owner])).rows[0].n,4);
  assert.equal((await db.query('select * from public.claim_email_digest_deliveries($1,true)',[owner])).rows.length,0);
 }finally{await db.exec('rollback');}
});

test('email template groups names safely and never includes absent deadline sections',()=>{
 const {renderReminderEmail}=load('../supabase/functions/_shared/emailTemplates.ts');
 const mail=renderReminderEmail({to:'test@example.com',ingredients:[{name:'<script>두부</script>',expiryDate:'2026-11-03',daysLeft:1},{name:'우유',expiryDate:'2026-11-03',daysLeft:1}]});
 assert.equal(mail.subject,'[콕집서] 냉장고 속 재료를 확인해 주세요');assert.match(mail.html,/총 2개/);assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);assert.doesNotMatch(mail.html,/D-Day|D-3/);assert.match(mail.text,/D-1/);
});

test('more than 25 ingredients from one account stay in one digest and opt-out cancels the whole unsent digest',async()=>{
 await db.exec('begin');try{
  const owner='b2000000-0000-4000-8000-000000000001';await db.query('insert into auth.users values($1)',[owner]);
  await db.query("insert into public.email_notification_settings(user_id,email,email_verified_at,enabled,consent_at,consent_version) values($1,'many@example.com',now(),true,now(),'email-reminders-v1')",[owner]);
  for(let i=0;i<32;i++){const id=crypto.randomUUID();await db.query("insert into public.ingredients(id,user_id,name,category,expiry_date,payload) values($1::uuid,$2::uuid,$3,'채소',(now() at time zone 'Asia/Seoul')::date+1,jsonb_build_object('id',$1::text,'name',$3::text,'category','채소'))",[id,owner,'재료'+i]);}
  await db.query('select public.refresh_email_notification_schedule_for_user($1)',[owner]);
  const jobs=(await db.query('select * from public.claim_email_digest_deliveries($1,true)',[owner])).rows;
  assert.equal(jobs.length,32);assert.equal(new Set(jobs.map(row=>row.digest_id)).size,1);
  await db.query('update public.email_notification_settings set enabled=false where user_id=$1',[owner]);
  assert.equal((await db.query('select public.prepare_email_digest($1,$2) as mail',[jobs[0].digest_id,jobs[0].lease_token])).rows[0].mail,null);
 }finally{await db.exec('rollback');}
});

test('worker sends one digest per account, not one per ingredient',async()=>{
 const jobs=[{id:'a1',user_id:'a',digest_id:'a-digest',lease_token:'a-lease'},{id:'a2',user_id:'a',digest_id:'a-digest',lease_token:'a-lease'},{id:'b1',user_id:'b',digest_id:'b-digest',lease_token:'b-lease'}];
 const sent=[],finished=[];
 const fetcher=async(url,options)=>{
  const input=JSON.parse(options.body);
  if(url.endsWith('claim_email_digest_deliveries'))return Response.json(jobs);
  if(url.endsWith('prepare_email_digest')){const userId=input.p_digest_id==='a-digest'?'a':'b';return Response.json({userId,email:userId+'@example.com',ingredients:jobs.filter(job=>job.user_id===userId).map(job=>({name:job.id,expiryDate:'2026-11-03',daysLeft:1,ingredientId:job.id,deliveryId:job.id}))});}
  if(url.endsWith('finish_email_digest'))finished.push(input);return Response.json(1);
 };
 const worker=createReminderWorker({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',EMAIL_CRON_SECRET:'cron',EMAIL_DISPATCH_ENABLED:'true'},async(mail,key)=>sent.push({mail,key}),fetcher);
 const result=await(await worker(new Request('https://test',{method:'POST',headers:{'x-cron-secret':'cron'}}))).json();
 assert.equal(result.sent,2);assert.equal(result.sentIngredients,3);assert.equal(sent.length,2);assert.equal(sent[0].mail.ingredients.length,2);assert.equal(sent[1].mail.ingredients.length,1);assert.equal(sent[0].mail.to,'a@example.com');assert.equal(sent[1].mail.to,'b@example.com');assert.equal(finished.length,2);
});
