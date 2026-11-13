import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(url){const exports={};new Function('exports','require',ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,path=>load(new URL(`${path}.ts`,url)));return exports;}
const {consumeIngredient}=load(new URL('../src/features/ingredients/consumeIngredient.ts',import.meta.url));
const repo=load(new URL('../src/features/ingredients/repository.ts',import.meta.url));
const report=load(new URL('../src/features/report/weeklyReport.ts',import.meta.url));
function setup(){const map=new Map();let fail=null;return {getItem:key=>map.get(key)??null,setItem:(key,value)=>{if(key===fail)throw Error('quota');map.set(key,value);},fail:key=>{fail=key}};}
const draft={name:'테스트 두부',category:'두부·콩류',storage:'냉장',quantity:1,unit:'개',date:'2020-01-01'};
test('explicit consumption overrides expired/spoiled classification, removes only selected item and survives reload without duplicate completion',()=>{
 const db=setup();const [item]=repo.saveIngredient(db,draft);repo.recordIngredientCondition(db,item.id,'못 먹겠어요 (상했어요)');const [other]=repo.saveIngredient(db,{...draft,name:'다른 재료'});
 consumeIngredient(db,item.id); assert.deepEqual(repo.loadIngredients(db).map(i=>i.id),[other.id]);const history=report.loadHistory(db);assert.equal(history.length,1);assert.equal(history[0].action,'consumed');assert.equal(report.buildWeeklyReport(repo.loadIngredients(db),history).consumed,1);
 assert.throws(()=>consumeIngredient(db,item.id));assert.equal(report.loadHistory(db).length,1);
});
test('history storage failure keeps item; item storage failure rolls history back',()=>{
 for(const key of [repo.INGREDIENTS_KEY,report.REPORT_HISTORY_KEY]){const db=setup();const [item]=repo.saveIngredient(db,draft);report.recordDisposal(db,item,new Date(),'discarded');const original=db.getItem(report.REPORT_HISTORY_KEY);db.fail(key);assert.throws(()=>consumeIngredient(db,item.id));assert.equal(repo.loadIngredients(db).length,1);assert.equal(db.getItem(report.REPORT_HISTORY_KEY),original);}
});

// Execute the actual detail-page callbacks so food cannot silently skip survey notification.
function detailHandler(name,item,events,fail=false){
 const source=ts.createSourceFile('App.tsx',readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let expression;
 const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='IngredientDetailPage'){
  const attribute=node.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.getText(source)===name);
  expression=attribute?.initializer?.expression?.getText(source);
 }ts.forEachChild(node,visit);};visit(source);
 assert.ok(expression,`${name} callback exists`);
 const code=ts.transpileModule(`return (${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const save=()=>{if(fail)throw Error('save failed');events.push('saved');};
 return new Function('ingredients','item','isFood','notifyIngredientStatusUpdated','navigate','detailOrigin','setDetailSavedDestination',code)(
  {recordCondition:save,updateDetails:save,consume:save,remove:save},item,value=>value.kind==='food',()=>events.push('survey'),()=>events.push('navigate'),'fridge',()=>{});
}

test('food and ingredients notify the survey after condition, quantity, consumption and disposal updates',()=>{
 for(const kind of ['food','ingredient'])for(const name of ['onCondition','onSave','onConsume','onDiscard']){
  const events=[],item={id:'item',kind,storage:'냉장',date:'2026-11-14',remainingPercent:100};
  detailHandler(name,item,events)(name==='onSave'?{...item,remainingPercent:75}:'괜찮아요');
  assert.deepEqual(events.slice(0,2),['saved','survey'],`${kind}: ${name}`);
 }
});

test('failed updates never invite a survey and unchanged detail saves do not count as updates',()=>{
 const item={id:'item',kind:'food',storage:'냉장',date:'2026-11-14',remainingPercent:75};
 for(const name of ['onCondition','onSave','onConsume','onDiscard']){
  const events=[];
  assert.throws(()=>detailHandler(name,item,events,true)({...item,remainingPercent:50}),/save failed/);
  assert.deepEqual(events,[]);
 }
 const events=[];detailHandler('onSave',item,events)({...item});
 assert.ok(!events.includes('survey'));
});
