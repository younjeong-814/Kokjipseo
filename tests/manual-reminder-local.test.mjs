import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const native=createRequire(import.meta.url),cache=new Map();
function load(url){
  if(cache.has(url.href))return cache.get(url.href);
  const exports={};cache.set(url.href,exports);
  const source=readFileSync(url,'utf8').replaceAll('import.meta.url',JSON.stringify(url.href));
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',code)(exports,name=>name.startsWith('.')?load(new URL(/\.ts$/.test(name)?name:name+'.ts',url)):native(name));return exports;
}
const {createLocalTestTransport}=load(new URL('../server/manualReminderTest.ts',import.meta.url));
const env={GMAIL_USER:'sender@example.com',GMAIL_APP_PASSWORD:'test-only'};
const mail={kind:'reminder',to:'recipient@example.com',name:'두부',expiryDate:'2026-11-03',ingredientId:'ingredient',deliveryId:'delivery',reminderType:'3_days'};
function directory(t){const prefix=join(tmpdir(),'kokjipseo-mail-test-'),path=mkdtempSync(prefix);t.after(()=>{if(path.startsWith(prefix))rmSync(path,{recursive:true,force:true});});return path;}
test('local SMTP attempt log deduplicates across new transport instances without storing personal data',async t=>{
  const path=directory(t);let calls=0;
  const options={directory:path,send:async message=>{calls++;assert.equal(message.to,mail.to);}};
  await createLocalTestTransport(env,options)(mail,'reminder:1');
  await createLocalTestTransport(env,options)(mail,'reminder:1');
  assert.equal(calls,1);
  const record=readFileSync(join(path,readdirSync(path)[0]),'utf8');assert.equal(JSON.parse(record).accepted,true);assert.match(JSON.parse(record).fingerprint,/^[a-f0-9]{64}$/);assert.ok(!record.includes('@'));
  await assert.rejects(()=>createLocalTestTransport(env,options)({...mail,to:'changed@example.com'},'reminder:1'),/previous_attempt_requires_review/);
});
test('uncertain SMTP failure never resends automatically even after creating another transport',async t=>{
  const path=directory(t);let calls=0;
  const options={directory:path,send:async()=>{calls++;throw new Error('connection_lost_after_send');}};
  await assert.rejects(()=>createLocalTestTransport(env,options)(mail,'reminder:2'));
  await assert.rejects(()=>createLocalTestTransport(env,options)(mail,'reminder:2'),/previous_attempt_requires_review/);
  assert.equal(calls,1);assert.equal(createLocalTestTransport({}),null);
});
