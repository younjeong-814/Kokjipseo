import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(url){const exports={};const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,p=>load(new URL(`${p}.ts`,url)));return exports;}
const {reportsFromActivities,applyDailyScores,latestSix,SCORE_KEY}=load(new URL('../src/features/mypage/statistics.ts',import.meta.url));
const {managementScore,managementGrade}=load(new URL('../src/features/mypage/score.ts',import.meta.url));
const now=new Date('2026-10-21T12:00:00+09:00');
const event=(itemId,type,at='2026-10-20T12:00:00+09:00',suffix='')=>({id:type+itemId+suffix,itemId,type,at,name:'재료',category:'채소'});
const registrations=Array.from({length:6},(_,i)=>event(String(i),'registered','2026-10-18T12:00:00+09:00'));
const events=[...registrations,event('0','consumed'),event('1','consumed'),event('2','discarded'),event('3','discarded'),event('4','storage'),event('4','condition'),event('5','condition')];
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}};
test('six targets, two consumed, two discarded; repeated management counts once',()=>{const r=reportsFromActivities(events,now)['주간'];assert.equal(r.managedCount,6);assert.equal(Math.round(r.consumptionRate),33);assert.equal(Math.round(r.managementRate),33);assert.equal(r.consumed.current,2);assert.equal(r.discarded.current,2);assert.equal(managementScore(r.consumptionRate,r.managementRate),33)});
test('partial and full consumption count same ingredient once',()=>{const r=reportsFromActivities([...events,event('0','partial')],now)['주간'];assert.equal(r.consumed.current,2)});
test('previously discarded items excluded from current period targets; future ignored',()=>{const r=reportsFromActivities([...events,event('5','discarded','2026-10-18T13:00:00+09:00'),event('6','registered','2026-10-22T00:00:00+09:00')],now)['주간'];assert.equal(r.managedCount,5)});
test('six am score boundary follows the device local timezone',()=>{const before=new Date(2026,9,21,5,59,59), after=new Date(2026,9,21,6,0,0);const priorDay=new Date(2026,9,20,6,0,0);assert.equal(latestSix(before.getTime()),priorDay.getTime());assert.equal(latestSix(after.getTime()),after.getTime())});
test('score frozen until next six while live statistics change',()=>{const store=memory();const first=applyDailyScores(store,reportsFromActivities(events,now),events,now)['주간'].score;const changed=[...events,event('4','consumed','2026-10-21T13:00:00+09:00')];const later=new Date('2026-10-21T14:00:00+09:00');const live=applyDailyScores(store,reportsFromActivities(changed,later),changed,later)['주간'];assert.equal(live.score,first);assert.equal(live.consumed.current,3);const next=new Date('2026-10-22T06:00:00+09:00');assert.notEqual(applyDailyScores(store,reportsFromActivities(changed,next),changed,next)['주간'].score,first)});
test('corrupt snapshot preserved and no invented empty score',()=>{const store=memory();assert.equal(applyDailyScores(store,reportsFromActivities([],now),[],now)['주간'].score,null);store.setItem(SCORE_KEY,'broken');assert.throws(()=>applyDailyScores(store,reportsFromActivities(events,now),events,now));assert.equal(store.getItem(SCORE_KEY),'broken')});
test('weighted score and grade boundaries',()=>{assert.equal(managementScore(50,100),65);assert.equal(managementScore(null,0),null);for(const [n,text] of [[90,'냉장고 관리 달인 Master'],[75,'알뜰한 냉장고 Pro'],[60,'차곡차곡 관리 중'],[40,'냉장고 살펴보는 중'],[0,'관리 시작 단계']])assert.equal(managementGrade(n),text)});
const {syncActivities,readActivities,ACTIVITY_KEY}=load(new URL('../src/features/mypage/activityLog.ts',import.meta.url));
test('journal preserves registration and state history after removal and repeated sync',()=>{const store=memory();const item={id:'x',name:'양파',category:'채소',storage:'냉장',date:'2026-11-01',createdAt:'2026-10-18T00:00:00Z',conditionHistory:[{id:'condition-1',recordedAt:'2026-10-20T00:00:00Z',status:'싱싱해요'}]};const next={...item,storage:'냉동',remainingPercent:75};syncActivities(store,[next],[],[item],now);syncActivities(store,[],[{id:'x',name:'양파',action:'consumed',recordedAt:now.toISOString(),createdAt:item.createdAt,category:item.category}], [next],now);const saved=readActivities(store);assert.equal(saved.filter(e=>e.type==='registered').length,1);assert.equal(saved.filter(e=>e.type==='storage').length,1);assert.equal(saved.filter(e=>e.type==='partial').length,1);assert.equal(saved.filter(e=>e.type==='condition').length,1);assert.equal(saved.filter(e=>e.type==='consumed').length,1);syncActivities(store,[],[],[],now);assert.deepEqual(readActivities(store),saved)});
test('damaged activity journal is not overwritten',()=>{const store=memory();store.setItem(ACTIVITY_KEY,'broken');assert.throws(()=>syncActivities(store,[],[]));assert.equal(store.getItem(ACTIVITY_KEY),'broken')});
test('score change guides when previous period has only registrations',()=>{const r=applyDailyScores(memory(),reportsFromActivities(events,now),events,now);assert.equal(r['주간'].scoreChange,'다음 주부터 지난주와 비교해 드릴게요');assert.equal(r['월간'].scoreChange,'다음 달부터 지난달과 비교해 드릴게요');assert.equal(r['연간'].scoreChange,'내년부터 지난해와 비교해 드릴게요')});
test('score change shows update time until three items are completed',()=>{const few=[...registrations,event('0','consumed')];const r=applyDailyScores(memory(),reportsFromActivities(few,now),few,now);for(const p of ['주간','월간','연간']){assert.notEqual(r[p].score,null);assert.equal(r[p].scoreChange,'점수는 매일 오전 6시에 업데이트돼요')}});
test('score change shows update time when no score yet',()=>{const r=applyDailyScores(memory(),reportsFromActivities([],now),[],now);for(const p of ['주간','월간','연간'])assert.equal(r[p].scoreChange,'점수는 매일 오전 6시에 업데이트돼요')});
test('score change compares with previous period consumption records',()=>{const withPrev=[...events,event('7','registered','2026-10-12T12:00:00+09:00'),event('7','consumed','2026-10-13T12:00:00+09:00')];const r=applyDailyScores(memory(),reportsFromActivities(withPrev,now),withPrev,now)['주간'];assert.match(r.scoreChange,/^[↗↘] 지난주보다 \d+점 (올랐|내렸)어요$|^지난주와 같은 점수예요$/)});
test('discard feedback hidden without previous discards and phrased by direction',()=>{const {discardFeedback,withAnd}=load(new URL('../src/features/mypage/report.ts',import.meta.url));assert.equal(reportsFromActivities(events,now)['주간'].feedbackTitle,null);assert.deepEqual(discardFeedback('지난달','이번 달',20,17),{feedbackTitle:'지난달보다 폐기율이 15% 줄었어요!',feedbackDescription:'이번 달도 알뜰하게 관리하고 있어요'});assert.equal(discardFeedback('지난주','이번 주',2,3).feedbackTitle,'지난주보다 폐기율이 50% 늘었어요');assert.equal(withAnd('지난달'),'지난달과');assert.equal(withAnd('지난해'),'지난해와')});
test('last week disposal records fill the previous column of the comparison table',()=>{
  const at=new Date('2026-11-07T17:30:00+09:00');
  const rec=(id,name,action,recordedAt,createdAt)=>({id,name,action,recordedAt:new Date(recordedAt).toISOString(),createdAt:new Date(createdAt).toISOString(),category:'채소'});
  const history=[
    // 이번 주(11/2~) 실제 계정과 같은 기록
    rec('tofu','두부','discarded','2026-11-07T17:21:27+09:00','2026-10-19T23:03:13+09:00'),
    rec('pork','돼지','consumed','2026-11-07T10:21:32+09:00','2026-11-05T21:09:49+09:00'),
    rec('fruit','과일','consumed','2026-11-05T23:01:10+09:00','2026-11-05T23:01:08+09:00'),
    rec('duck','오리고기','consumed','2026-11-04T23:05:02+09:00','2026-11-04T23:00:52+09:00'),
    // 지난주(10/26~11/1) 테스트 기록
    rec('egg','계란','consumed','2026-10-28T12:00:00+09:00','2026-10-26T09:00:00+09:00'),
    rec('milk','우유','consumed','2026-11-01T20:00:00+09:00','2026-10-27T09:00:00+09:00'),
    rec('spinach','시금치','discarded','2026-10-30T08:00:00+09:00','2026-10-26T09:00:00+09:00'),
  ];
  const store=memory();
  const events=syncActivities(store,[],history,[],at);
  const r=applyDailyScores(memory(),reportsFromActivities(events,at),events,at)['주간'];
  assert.deepEqual(r.consumed,{previous:2,current:3});
  assert.deepEqual(r.discarded,{previous:1,current:1});
  assert.match(r.scoreChange,/^[↗↘] 지난주보다 \d+점 (올랐|내렸)어요$|^지난주와 같은 점수예요$/);
});
