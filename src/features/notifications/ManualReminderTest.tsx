import { useEffect, useState } from 'react';
import { supabase } from '../cloud/client';
import { ActionButton } from '../../components/ActionButton';

type Target = { user_id:string; ingredients:number; expired:number; eligible:number };
type Result = { mode:string; sent:number; failed:number; cancelled:number; sentIngredients?:number; users?:Record<string,{sent:number;failed:number;cancelled:number}> };
async function call(action:'status'|'inspect'|'run') {
  if(!supabase)throw new Error('계정 연결을 확인해 주세요.');
  const {data:session}=await supabase.auth.getSession();
  if(!session.session)throw new Error('로그인이 필요해요.');
  const response=await fetch('/api/email-reminder-test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.session.access_token}`},body:JSON.stringify({action})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'테스트 서버에 연결하지 못했어요.');
  return data;
}
export function ManualReminderTest() {
  const [allowed,setAllowed]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const [targets,setTargets]=useState<Target[]|null>(null),[result,setResult]=useState<Result|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;void call('status').then(data=>{if(active){setAllowed(data.enabled===true);setReady(data.sendingReady===true);}}).catch(()=>{});return()=>{active=false;};},[]);
  if(!allowed)return null;
  const inspect=async()=>{
    if(busy)return;setBusy(true);setError('');setResult(null);setTargets(null);
    try{const data=await call('inspect');setTargets(data.users);setReady(data.sendingReady===true);}
    catch(e){setError(e instanceof Error?e.message:'검사에 실패했어요.');}finally{setBusy(false);}
  };
  const run=async()=>{
    if(busy)return;setBusy(true);setError('');setResult(null);
    try{const data=await call('run');setResult(data);setTargets(null);}
    catch(e){setError(e instanceof Error?e.message:'발송 결과를 확인해 주세요.');setTargets(null);}finally{setBusy(false);}
  };
  const count=targets?.reduce((total,row)=>total+row.eligible,0)??0;
  return <section className="manual-reminder-test" aria-labelledby="manual-reminder-title">
    <h2 id="manual-reminder-title">UT 전 알림 발송 테스트</h2>
    <p>내 계정의 D-3·D-1·당일 알림을 오전 9시와 같은 조건으로 검사합니다. 기한 경과·알림 꺼짐·미인증·이미 발송한 항목은 제외해요.</p>
    <ActionButton disabled={busy} onClick={()=>void inspect()}>{busy?'처리 중이에요':'알림 대상 즉시 검사'}</ActionButton>
    {targets&&<>
      <p role="status">내 계정 · 발송 대기 {count}건</p>
      <div className="manual-reminder-table"><table><caption>내 냉장고 알림 대상 검사 결과</caption><thead><tr><th>계정 ID</th><th>보관</th><th>기한 경과</th><th>발송 대기</th></tr></thead><tbody>{targets.map(row=><tr key={row.user_id}><th scope="row" title={row.user_id}>{row.user_id.slice(0,8)}</th><td>{row.ingredients}</td><td>{row.expired}</td><td>{row.eligible}</td></tr>)}</tbody></table></div>
      {!ready&&<p>발송 연결 또는 서버의 발송 허용 설정이 준비되지 않았어요. 검사는 가능하지만 메일은 보내지 않아요.</p>}
      <p>아래 버튼을 누르면 내 계정의 인증된 알림 이메일로 실제 메일을 보냅니다. D-Day·D-1·D-3 대상 재료를 한 통으로 모아 보내며, 1분 간격으로 실행할 수 있어요.</p>
      <ActionButton disabled={busy||!ready||count===0} onClick={()=>void run()}>내 알림 이메일로 테스트 발송</ActionButton>
    </>}
    {result&&<div role="status"><p>메일 발송 성공 {result.sent}통 · 실패 {result.failed}통 · 포함 재료 {result.sentIngredients??0}개 · 제외 {result.cancelled}개</p><p>성공은 메일 제공자의 접수 기준입니다. 수신함에서도 확인해 주세요. 남은 대상을 확인하려면 다시 검사해 주세요.</p>{result.users&&<ul>{Object.entries(result.users).map(([id,row])=><li key={id} title={id}>{id.slice(0,8)}: 성공 {row.sent} · 실패 {row.failed} · 제외 {row.cancelled}</li>)}</ul>}</div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
