import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const cache=new Map();
function load(url){url=new URL(url,import.meta.url);if(cache.has(url.href))return cache.get(url.href);const exports={};cache.set(url.href,exports);const source=readFileSync(url,'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,p=>load(new URL(p.endsWith('.ts')?p:`${p}.ts`,url)));return exports;}
const {CloudStorage,cacheKey,preservePendingBeforeReload}=load('../src/features/cloud/storage.ts');
const {emptySnapshot,mergeSnapshots,validateSnapshot,snapshotKeys,parseBackup}=load('../src/features/cloud/snapshot.ts');
const {securedHandler,imageBody}=load('../supabase/functions/_shared/http.ts');
const {parsePhotoResult,recognizePhoto}=load('../supabase/functions/_shared/photo.ts');
const {configureExternalRequests,requestExternal}=load('../src/features/cloud/externalRequests.ts');
const {ensureAnonymousSession}=load('../src/features/cloud/anonymous.ts');

test('anonymous bootstrap reuses permanent and anonymous sessions without creating users',async()=>{
 for(const is_anonymous of [true,false]){
  const session={user:{id:'existing',is_anonymous}};
  const client={auth:{getSession:async()=>({data:{session}}),signInAnonymously:()=>{throw new Error('must not create')}}};
  assert.equal(await ensureAnonymousSession(client),session);
 }
});
test('concurrent anonymous bootstrap creates one account; errors never fall back to new identities',async()=>{
 let created=0;
 const session={user:{id:'new',is_anonymous:true}};
 const client={auth:{getSession:async()=>({data:{session:null}}),signInAnonymously:async()=>{created++;return {data:{session}}}}};
 const results=await Promise.all([ensureAnonymousSession(client),ensureAnonymousSession(client)]);
 assert.equal(created,1);assert.equal(results[0],results[1]);
 await assert.rejects(()=>ensureAnonymousSession({auth:{...client.auth,getSession:async()=>({data:{session:null},error:new Error('refresh failed')})}}));
 assert.equal(created,1);
 await assert.rejects(()=>ensureAnonymousSession({auth:{...client.auth,signInAnonymously:async()=>({data:{session:null},error:new Error('disabled')})}}));
 assert.equal(await ensureAnonymousSession(client),session);
});
const disk=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}};
const ingredient=(id='20000000-0000-4000-8000-000000000001',name='양파')=>({id,name,category:'채소',storage:'냉장',quantity:1,unit:'개',date:'2026-12-01',createdAt:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z'});
const remote=(revision=0)=>({...emptySnapshot(),revision});
test('cloud storage isolates owners and preserves guest data',()=>{
 const store=disk();store.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient()]));const a=new CloudStorage(store,'a',remote(),()=>{});a.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient()]));const b=new CloudStorage(store,'b',remote(),()=>{});assert.deepEqual(JSON.parse(b.getItem(snapshotKeys.ingredients)),[]);assert.equal(JSON.parse(store.getItem(snapshotKeys.ingredients)).length,1);assert.equal(a.pending,true);assert.equal(b.pending,false);
});
test('outbox survives reload; acknowledge never drops writes made while request was in flight',()=>{
 const store=disk();const a=new CloudStorage(store,'a',remote(),()=>{});a.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient()]));const sent=a.snapshot();a.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient(undefined,'대파')]));a.acknowledge(1,sent);assert.equal(a.pending,true);assert.equal(a.revision,1);const resumed=new CloudStorage(store,'a',remote(1),()=>{});assert.equal(resumed.snapshot().ingredients[0].name,'대파');resumed.acknowledge(2,resumed.snapshot());assert.equal(resumed.pending,false);
});
test('remote revision conflict never overwrites durable pending data',()=>{
 const store=disk();const a=new CloudStorage(store,'a',remote(),()=>{});a.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient()]));const before=store.getItem(cacheKey('a'));assert.throws(()=>new CloudStorage(store,'a',remote(1),()=>{}),/충돌/);assert.equal(store.getItem(cacheKey('a')),before);preservePendingBeforeReload(store,'a');assert.equal(new CloudStorage(store,'a',remote(1),()=>{}).pending,false);
});
test('failed local persistence leaves previous snapshot intact',()=>{const store=disk();const a=new CloudStorage(store,'a',remote(),()=>{});store.setItem=()=>{throw new Error('quota')};assert.throws(()=>a.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient()])));assert.deepEqual(a.snapshot().ingredients,[])});
test('malformed remote/local records are rejected and merge keeps remote duplicates',()=>{
 assert.throws(()=>validateSnapshot({...remote(),ingredients:[{id:'bad'}]}));const r={...emptySnapshot(),ingredients:[ingredient(undefined,'서버')]};const guest={...emptySnapshot(),ingredients:[ingredient(undefined,'로컬'),ingredient('20000000-0000-4000-8000-000000000002')]};const combined=mergeSnapshots(r,guest);assert.equal(combined.ingredients.length,2);assert.equal(combined.ingredients[0].name,'서버');assert.equal(guest.ingredients[0].name,'로컬');
});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test-key'};
const req=(origin='https://younjeong-814.github.io',token=true)=>new Request('https://example.supabase.co/functions/v1/recipes',{headers:{Origin:origin,...(token?{Authorization:'Bearer signed-user-token'}:{})}});
test('Edge rejects missing auth, blocked origin and wrong method before provider call',async()=>{
 let calls=0;const handler=securedHandler(env,'recipes','GET',async()=>{calls++;return {}},async()=>{throw new Error('should not fetch')});assert.equal((await handler(req(undefined,false))).status,401);assert.equal((await handler(req('https://untrusted.example'))).status,403);assert.equal((await handler(new Request('https://x',{method:'POST'}))).status,405);assert.equal((await handler(new Request('https://x',{method:'OPTIONS',headers:{Origin:'https://younjeong-814.github.io'}}))).status,204);assert.equal(calls,0);
});
test('Edge verifies user and database budget before calling external API',async()=>{
 let actions=0,calls=0;const handler=securedHandler(env,'recipes','GET',async()=>{actions++;return {recipes:[]}},async(url,init)=>{calls++;if(url.endsWith('/user'))return Response.json({id:'user-a'});assert.equal(JSON.parse(init.body).api_kind,'recipes');return Response.json(true)});const result=await handler(req());assert.equal(result.status,200);assert.equal(result.headers.get('Access-Control-Allow-Origin'),'https://younjeong-814.github.io');assert.equal(calls,2);assert.equal(actions,1);
 const limited=securedHandler(env,'recipes','GET',async()=>{actions++;},async url=>Response.json(url.endsWith('/user')?{id:'user-a'}:false));assert.equal((await limited(req())).status,429);assert.equal(actions,1);
});
test('provider failures never leak credentials or upstream URLs',async()=>{const handler=securedHandler(env,'ocr','GET',async()=>{throw new Error('https://provider?key=PRIVATE-CREDENTIAL')},async url=>Response.json(url.endsWith('/user')?{id:'a'}:true));const result=await handler(req());assert.equal(result.status,502);assert.doesNotMatch(await result.text(),/PRIVATE|provider/)});
test('photo parsing accepts structured food results but rejects invented category and invalid quantities',()=>{assert.equal(parsePhotoResult({items:[{name:' 양파 ',category:'채소',quantity:1,uncertain:false}]})[0].name,'양파');assert.deepEqual(parsePhotoResult({items:[]}),[]);assert.throws(()=>parsePhotoResult({items:[{name:'양파',category:'unknown',quantity:0,uncertain:false}]}))});
test('image body validates format and enforces bounded payload size',async()=>{const make=x=>new Request('https://x',{method:'POST',body:JSON.stringify(x)});assert.equal((await imageBody(make({image:'/9j/AAAA',mode:'fridge'}))).mode,'fridge');await assert.rejects(()=>imageBody(make({image:'not-jpeg'})));await assert.rejects(()=>imageBody(make({image:'/9j/'+'A'.repeat(6*1024*1024)})),e=>e.status===413)});
test('Gemini request uses secret header; results are validated and upstream errors sanitized',async()=>{
 let captured;const result=await recognizePhoto('PRIVATE','gemini-test','/9j/AAAA','fridge',async(url,init)=>{captured={url,init};return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items:[{name:'두부',category:'두부·콩류',quantity:1,uncertain:true}]})}]}}]})});assert.equal(result[0].name,'두부');assert.ok(!captured.url.includes('PRIVATE'));assert.equal(captured.init.headers['x-goog-api-key'],'PRIVATE');await assert.rejects(()=>recognizePhoto('PRIVATE','gemini-test','x','fridge',async()=>new Response('',{status:429})),e=>e.status===429);await assert.rejects(()=>recognizePhoto('PRIVATE','arbitrary-host','x','fridge'));
});
test('front-end gateway sends only project key and user JWT; no token means no fetch',async()=>{
 const old=globalThis.fetch;let requested;try{globalThis.fetch=async(url,init)=>{requested={url,init};return Response.json({})};configureExternalRequests({url:'https://example.supabase.co',key:'sb_publishable_test',token:async()=>'user-token'});await requestExternal('recipes','/api/recipes?ingredient=양파');assert.match(requested.url,/functions\/v1\/recipes\?ingredient=/);assert.equal(requested.init.headers.get('Authorization'),'Bearer user-token');configureExternalRequests({url:'https://example.supabase.co',key:'sb_publishable_test',token:async()=>null});requested=null;await assert.rejects(()=>requestExternal('ocr','/api/ocr'));assert.equal(requested,null);}finally{configureExternalRequests(null);globalThis.fetch=old}
});
test('another tab cannot overwrite a durable pending snapshot',()=>{const store=disk();const a=new CloudStorage(store,'a',remote(),()=>{});const b=new CloudStorage(store,'a',remote(),()=>{});a.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient()]));const before=store.getItem(cacheKey('a'));assert.throws(()=>b.setItem(snapshotKeys.ingredients,JSON.stringify([ingredient(undefined,'stale')])));assert.equal(store.getItem(cacheKey('a')),before)});

test('backup import reads exported account caches and bare snapshots; merge keeps current records',()=>{
 const recipe={id:'r1',name:'국',image:'',summary:'',category:'',calories:'',time:'',difficulty:'',servings:'',ingredients:[],steps:[]};
 const exported=JSON.stringify({revision:3,pending:true,extras:{},snapshot:{...emptySnapshot(),recipes:[recipe]}});
 assert.deepEqual(parseBackup(exported).recipes,[recipe]);
 assert.deepEqual(parseBackup(JSON.stringify({recipes:[recipe]})),{...emptySnapshot(),recipes:[recipe]});
 assert.throws(()=>parseBackup('not json'),/백업 파일을 읽지 못했어요/);
 assert.throws(()=>parseBackup(JSON.stringify({recipes:[{id:'broken'}]})),/백업 파일을 읽지 못했어요/);
 const current={...emptySnapshot(),recipes:[{...recipe,name:'최신'}]};
 assert.equal(mergeSnapshots(current,parseBackup(exported)).recipes[0].name,'최신');
});
test('Google login returns to the screen where it started; an already-linked Google account signs in instead',()=>{
 const {rememberAuthReturn,restoreAuthReturn,AUTH_RETURN_KEY}=load('../src/features/cloud/authReturn.ts');
 const data=new Map();const store={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const urls=[];const restore=(search,hash)=>restoreAuthReturn({pathname:'/',search,hash},store,u=>urls.push(u));
 rememberAuthReturn({pathname:'/',search:'',hash:'#settings'},store);
 assert.equal(restore('',''),false);assert.deepEqual(urls,[]);assert.equal(data.get(AUTH_RETURN_KEY),'#settings');
 assert.equal(restore('?code=abc',''),false);
 assert.deepEqual(urls,['/?code=abc#settings']);assert.equal(data.has(AUTH_RETURN_KEY),false);
 rememberAuthReturn({pathname:'/',search:'',hash:''},store);
 assert.equal(restore('','#error=server_error&error_code=identity_already_exists&error_description=x'),true);
 assert.equal(urls.at(-1),'/#settings');
 rememberAuthReturn({pathname:'/',search:'',hash:'#settings'},store);
 assert.equal(restore('?error=access_denied&error_code=access_denied',''),false);
 assert.equal(urls.at(-1),'/#settings');
 assert.equal(restore('?error_code=identity_already_exists',''),false,'without a login started here, never redirect');
});

test('guest records are stashed before relogin and merged into the existing Google account',async()=>{
 const {stashGuestRecords,takeGuestRecords,mergeGuestRecords,GUEST_TRANSFER_KEY}=load('../src/features/cloud/guestTransfer.ts');
 const mem=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
 const recipe=(id,name)=>({id,name,image:'',summary:'',category:'',calories:'',time:'',difficulty:'',servings:'',ingredients:[],steps:[]});
 const now=new Date('2026-10-31T00:00:00Z');
 // 서버 기록 + 이 기기의 미전송분 중 최신(미전송분)을 보관한다.
 const disk=mem();
 disk.setItem(cacheKey('anon'),JSON.stringify({revision:2,pending:true,snapshot:{...emptySnapshot(),recipes:[recipe('a','임시 미전송')]},extras:{}}));
 assert.equal(await stashGuestRecords('anon',async()=>({revision:2,...emptySnapshot(),recipes:[recipe('a','임시 서버')]}),disk,now),true);
 // 같은 계정(연결 성공)이면 합치지 않는다.
 assert.equal(takeGuestRecords('anon',mem(),now),null);
 const guest=takeGuestRecords('google',disk,now);
 assert.equal(guest.recipes[0].name,'임시 미전송');assert.equal(disk.getItem(GUEST_TRANSFER_KEY),null);
 // 로그인한 계정의 기록을 우선하고, 없는 임시 기록만 더한다.
 let saved={...emptySnapshot(),recipes:[recipe('b','계정')]};const writes=[];
 const store={snapshot:()=>JSON.parse(JSON.stringify(saved)),setItem:(k,v)=>{writes.push(k);saved={...saved,recipes:JSON.parse(v)};}};
 assert.deepEqual(mergeGuestRecords(store,guest),['recipes']);
 assert.deepEqual(saved.recipes.map(r=>r.name).sort(),['계정','임시 미전송']);
 // 오래된 보관분, 서버·캐시 모두 확인 못 한 경우
 const old=mem();await stashGuestRecords('anon',async()=>({revision:0,...emptySnapshot(),recipes:[recipe('c','x')]}),old,now);
 assert.equal(takeGuestRecords('google',old,new Date(now.getTime()+2*60*60*1000)),null);
 await assert.rejects(stashGuestRecords('anon',async()=>{throw new Error('offline')},mem(),now));
});
test('records saved before account storage are merged once and archived',()=>{
 const {takeLocalRecords,archiveLocalRecords,mergeGuestRecords,LOCAL_BACKUP_KEY}=load('../src/features/cloud/guestTransfer.ts');
 const mem=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
 const disk=mem();
 assert.equal(takeLocalRecords(disk),null);
 const old={id:'old',name:'우유',action:'consumed',recordedAt:'2026-10-20T00:00:00Z',createdAt:'2026-10-15T00:00:00Z'};
 disk.setItem(snapshotKeys.history,JSON.stringify([old]));
 const local=takeLocalRecords(disk);
 assert.deepEqual(local.history,[old]);
 let saved={...emptySnapshot(),history:[{...old,id:'new',recordedAt:'2026-11-03T00:00:00Z'}]};
 const store={snapshot:()=>JSON.parse(JSON.stringify(saved)),setItem:(k,v)=>{assert.equal(k,snapshotKeys.history);saved={...saved,history:JSON.parse(v)};}};
 assert.deepEqual(mergeGuestRecords(store,local),['history']);
 assert.deepEqual(saved.history.map(r=>r.id).sort(),['new','old']);
 archiveLocalRecords(disk,new Date(1));
 assert.equal(disk.getItem(snapshotKeys.history),null);
 assert.deepEqual(JSON.parse(disk.getItem(`${LOCAL_BACKUP_KEY}.1`))[snapshotKeys.history],JSON.stringify([old]));
 assert.equal(takeLocalRecords(disk),null);
 // 읽지 못하는 원본은 건드리지 않는다.
 const broken=mem();broken.setItem(snapshotKeys.history,'{');
 assert.equal(takeLocalRecords(broken),null);assert.equal(broken.getItem(snapshotKeys.history),'{');
});

const {isEmailReturn,prepareEntrySession}=load('../src/features/cloud/emailReturn.ts');
test('email navigation marker is exact and never an account identity',()=>{
 assert.equal(isEmailReturn('#fridge?source=email'),true);
 for(const hash of ['#fridge','#fridge?source=other','#fridge?email=test@example.com'])assert.equal(isEmailReturn(hash),false);
});
test('mail arrivals reuse either session and never create an anonymous account without one',async()=>{
 for(const session of [null,{user:{id:'a',is_anonymous:true}},{user:{id:'b',is_anonymous:false}}]){
  const client={auth:{getSession:async()=>({data:{session}}),signInAnonymously:()=>{throw new Error('unexpected new account');}}};
  assert.equal(await prepareEntrySession(client,true),session);
 }
 await assert.rejects(()=>prepareEntrySession({auth:{getSession:async()=>({data:{session:null},error:new Error('offline')})}},true),/offline/);
});
test('ordinary arrivals still create an anonymous session',async()=>{
 const session={user:{id:'new',is_anonymous:true}};
 assert.equal(await prepareEntrySession({auth:{getSession:async()=>({data:{session:null}}),signInAnonymously:async()=>({data:{session}})}},false),session);
});
const {renderReminderEmail}=load('../supabase/functions/_shared/emailTemplates.ts');
test('reminder HTML and text carry the email return marker',()=>{
 const mail=renderReminderEmail({to:'tester@example.com',ingredients:[{name:'양파',expiryDate:'2026-11-03'}]});
 assert.ok(mail.html.includes('#fridge?source=email'));
 assert.ok(mail.text.includes('#fridge?source=email'));
});
test('Gemini photo request lowers thinking by model and retries without it when unsupported',async()=>{
 const {thinkingConfig}=load('../supabase/functions/_shared/photo.ts');
 assert.deepEqual(thinkingConfig('gemini-2.5-flash'),{thinkingBudget:0});assert.deepEqual(thinkingConfig('gemini-3.6-flash'),{thinkingLevel:'minimal'});assert.deepEqual(thinkingConfig('gemini-3-pro'),{thinkingLevel:'low'});assert.equal(thinkingConfig('gemini-2.0-flash'),undefined);
 const bodies=[];const ok=()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items:[]})}]}}]});
 await recognizePhoto('K','gemini-3.6-flash','/9j/AAAA','product',async(url,init)=>{bodies.push(JSON.parse(init.body).generationConfig);return bodies.length===1?new Response('',{status:400}):ok()});
 assert.equal(bodies.length,2);assert.deepEqual(bodies[0].thinkingConfig,{thinkingLevel:'minimal'});assert.equal(bodies[1].thinkingConfig,undefined);
});
