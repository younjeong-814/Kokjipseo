import {useEffect,useState} from 'react';
import {OverlayDialog} from '../../components/OverlayDialog';
import {supabase} from '../cloud/client';
import {entrySource} from './UTTracker';
import emailIcon from '../../assets/ut-survey/icon-email.svg';
import surveyIcon from '../../assets/ut-survey/icon-survey.svg';
import closeIcon from '../../assets/ut-survey/icon-close.svg';

const SURVEY_URL='https://docs.google.com/forms/d/e/1FAIpQLSdnLd4D7twDKh2W2oBpA3ijZMqbRF15ZLgkVff4MDEII-r1MQ/viewform';

/** 첫 진입 때 1차 사용성 설문을 안내한다. 표시 조건은 참여 정보가 없는 로그인 사용자로 유지한다. */
export function UTConsentSheet({userId}:{userId:string}){
  const [open,setOpen]=useState(false);
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
  return <OverlayDialog label="콕집서 1차 사용성 설문 안내" onClose={()=>setOpen(false)} dismissOutside={false} className="ut-consent-sheet">
    <div className="ut-survey-content">
      <header className="ut-survey-header">
        <div>
          <p>식재료 등록 완료</p>
          <h2>첫 식재료 등록을 완료했어요!</h2>
          <span>방금 이용한 과정은 어떠셨나요?</span>
        </div>
        <button type="button" aria-label="닫기" onClick={()=>setOpen(false)}><img src={closeIcon} alt=""/></button>
      </header>
      <div className="ut-survey-cards">
        <section className="ut-survey-card">
          <div className="ut-survey-card-title"><img src={surveyIcon} alt=""/><strong>1차 사용성 설문</strong></div>
          <p>식재료를 등록하고 소비기한을 확인하면서 느낀 점을 알려주세요.</p>
          <span>총 3문항&nbsp; · &nbsp;약 1~2분</span>
        </section>
        <section className="ut-survey-followup"><img src={emailIcon} alt=""/><p>소비기한 알림 메일을 받으면 2차 테스트에 참여할 수 있어요.</p></section>
      </div>
    </div>
    <footer className="ut-survey-footer">
      <a className="action-button ut-survey-cta" href={SURVEY_URL} target="_blank" rel="noreferrer">1차 설문 참여하기</a>
      <p>설문 응답은 서비스 개선을 위해 활용됩니다.</p>
    </footer>
  </OverlayDialog>;
}
