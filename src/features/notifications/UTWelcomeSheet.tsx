import {useEffect,useRef,useState} from 'react';
import {ActionButton} from '../../components/ActionButton';
import {OverlayDialog} from '../../components/OverlayDialog';
import {supabase} from '../cloud/client';
import {setUTParticipation} from './client';
import {entrySource} from './UTTracker';

/** Test entry guidance is separate from the survey shown after registration. */
export function UTWelcomeSheet({userId}:{userId:string}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const working=useRef(false);
  useEffect(()=>{
    if(!supabase||entrySource()!=='pickply')return;
    let live=true;
    void(async()=>{
      const result=await supabase!.from('ut_participants').select('status').eq('user_id',userId).maybeSingle();
      // Existing participation, including withdrawal, must not be overwritten.
      if(live&&!result.error&&!result.data)setOpen(true);
    })().catch(()=>{});
    return()=>{live=false;};
  },[userId]);
  if(!open)return null;
  const start=async()=>{
    if(working.current)return;
    working.current=true;setBusy(true);setError('');
    try{await setUTParticipation(true);setOpen(false);}
    catch(e){setError(e instanceof Error?e.message:'저장하지 못했어요. 다시 시도해 주세요.');}
    finally{working.current=false;setBusy(false);}
  };
  return <OverlayDialog label="콕집서 사용성 테스트 안내" sheet dismissOutside={false} onClose={()=>{if(!working.current)setOpen(false);}} className="ut-welcome-sheet">
    <div className="ut-welcome-layout">
      <header><p className="ut-welcome-eyebrow">사용자 테스트</p><h2>콕집서 사용성 테스트</h2></header>
      <section className="ut-welcome-mission" aria-label="미션 안내"><strong>미션 안내</strong><p>냉장고 속 식재료를 등록하고 소비기한을 확인해 보세요. 등록을 완료하면 간단한 1차 설문이 진행돼요.</p></section>
      <p className="ut-welcome-note">소비기한이 다가오면 이메일로 알려드려요. 알림을 받고 다시 방문해 2차 테스트에도 참여해 주세요!</p>
      <p className="ut-welcome-consent">시작하면 앱 접속과 식재료 확인·관리 행동의 종류 및 시간을 임시 ID에 연결해 기록해요. 이메일 알림 수신 동의는 별도로 진행해요.</p>
      {error&&<p className="ut-welcome-error" role="alert">{error}</p>}
      <footer><ActionButton disabled={busy} onClick={()=>void start()}>{busy?'저장 중이에요':'테스트 시작하기'}</ActionButton></footer>
    </div>
  </OverlayDialog>;
}
