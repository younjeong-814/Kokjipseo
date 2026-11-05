import {useEffect,useState} from 'react';
import {ActionButton} from '../../components/ActionButton';
import {OverlayDialog} from '../../components/OverlayDialog';
import {supabase} from '../cloud/client';
import {setUTParticipation} from './client';
import {entrySource} from './UTTracker';

const MISSIONS=[
  '지금 냉장고에 있는 식재료를 1개 이상 등록해 주세요.',
  '식재료의 유통기한을 입력하고, 계산된 소비 권장일을 확인해 주세요.',
  '알림을 받을 이메일을 등록하고 인증해 주세요.',
  '등록을 마치면 나오는 짧은 설문에 응답해 주세요.',
] as const;

/** 첫 진입 때 미션을 안내하고, [테스트 시작하기]로 UT 참여·행동 기록 동의를 받는다. 동의 철회는 설정 화면의 UTParticipationControl에서 한다. */
export function UTConsentSheet({userId}:{userId:string}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    // 메일로 돌아온 사람은 이미 등록 과정을 거쳤으므로 다시 묻지 않는다.
    if(!supabase||entrySource()==='email')return;
    let live=true;
    void(async()=>{
      const result=await supabase!.from('ut_participants').select('status').eq('user_id',userId).maybeSingle();
      // 조회 실패 시에는 띄우지 않는다. 동의 여부를 모른 채 묻거나 기록하지 않는다.
      if(live&&!result.error&&!result.data)setOpen(true);
    })().catch(()=>{});
    return()=>{live=false;};
  },[userId]);
  if(!open)return null;
  const accept=async()=>{
    setBusy(true);setError('');
    try{await setUTParticipation(true);setOpen(false);}
    catch(e){setError(e instanceof Error?e.message:'저장하지 못했어요. 다시 시도해 주세요.');}
    finally{setBusy(false);}
  };
  return <OverlayDialog label="콕집서 사용성 테스트 안내" onClose={()=>setOpen(false)} sheet dismissOutside={false} className="ut-consent-sheet">
    <div className="ut-consent-layout">
      <header className="ut-consent-header">
        <p className="ut-consent-eyebrow">사용성 테스트</p>
        <h2>콕집서 사용성 테스트에<br/>오신 걸 환영해요</h2>
      </header>
      <section className="ut-consent-mission" aria-label="미션 안내">
        <strong>미션 안내</strong>
        <p>콕집서에 내 냉장고 속 식재료를 등록하고, 소비 권장일 알림을 받아보는 테스트예요.</p>
      </section>
      <p className="ut-consent-note">소비 권장일이 다가오면 메일로 알려드려요.</p> 
      {error&&<p className="ut-consent-error" role="alert">{error}</p>}
      <footer className="ut-consent-actions">
        <ActionButton disabled={busy} onClick={()=>void accept()}>{busy?'저장 중이에요':'테스트 시작하기'}</ActionButton>
      </footer>
    </div>
  </OverlayDialog>;
}
