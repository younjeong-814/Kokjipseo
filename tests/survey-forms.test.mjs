import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../scripts/survey-forms.gs',import.meta.url),'utf8');
test('Google submit matches immutable item ID despite title edits and trailing whitespace',()=>{
 const calls=[];
 const context=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-only-secret'})},UrlFetchApp:{fetch:(url,options)=>{calls.push({url,...options});return {getResponseCode:()=>204};}}});
 vm.runInContext(source,context);
 for(const [stage,formId,itemId] of [[1,'1aoVPM8zLkBuzXuhECyTQGM5iBvaxFGDMpl2YQaubmGU',1197603394],[2,'1MnS051RyLDyl-mURWcGKLygPjU0JQaf_asYG5tNqOT8',1678404314]]){
  context.completeSurvey({source:{getId:()=>formId},response:{getId:()=>`response-${stage}`,getItemResponses:()=>[{getItem:()=>({getId:()=>itemId,getTitle:()=> '참여 확인 코드 · 자동 입력 '}),getResponse:()=> '10000000-0000-4000-8000-000000000001'}]}});
  assert.deepEqual(JSON.parse(calls.at(-1).payload),{stage,code:'10000000-0000-4000-8000-000000000001',responseId:`response-${stage}`});
 }
 assert.equal(calls.length,2);
 assert.throws(()=>context.completeSurvey({source:{getId:()=> 'unknown'},response:{}}),/허용되지 않은/);
 assert.equal(calls.length,2);
});
test('second-form trigger never reads the broken container-bound response getter',()=>{
 const calls=[],properties=new Map([['UT_SURVEY_SECRET','test-only-secret']]);
 const formId='1MnS051RyLDyl-mURWcGKLygPjU0JQaf_asYG5tNqOT8';
 const response={getId:()=> 'second-response',getTimestamp:()=>new Date('2026-11-14T10:00:00Z'),getItemResponses:()=>[{getItem:()=>({getId:()=>1678404314}),getResponse:()=> '20000000-0000-4000-8000-000000000001'}]};
 let released=false;
 const context=vm.createContext({Date,console:{log(){},warn(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){released=true;}})},ScriptApp:{getProjectTriggers:()=>[{getUniqueId:()=> 'trigger-2',getTriggerSourceId:()=>formId}]},FormApp:{openById:id=>{assert.equal(id,formId);return {getResponses:()=>[response]};}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})},UrlFetchApp:{fetch:(url,options)=>{calls.push(JSON.parse(options.payload));return {getResponseCode:()=>204};}}});
 vm.runInContext(source,context);
 const event={triggerUid:'trigger-2',get response(){throw new Error('Google container-bound response lookup failed');}};
 context.completeSurvey(event);
 assert.deepEqual(calls,[{stage:2,code:'20000000-0000-4000-8000-000000000001',responseId:'second-response'}]);
 assert.equal(properties.get('SURVEY_SYNC_CURSOR_2'),'2026-11-14T10:00:00.000Z');
 assert.equal(released,true);
});
