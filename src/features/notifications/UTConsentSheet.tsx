import {useEffect,useState} from 'react';
import {OverlayDialog} from '../../components/OverlayDialog';
import {supabase} from '../cloud/client';
import {entrySource} from './UTTracker';
import {useSurveyTracking} from './useSurveyTracking';
import emailIcon from '../../assets/ut-survey/icon-email.svg';
import surveyIcon from '../../assets/ut-survey/icon-survey.svg';
import closeIcon from '../../assets/ut-survey/icon-close.svg';

const SURVEY_URL='https://docs.google.com/forms/d/e/1FAIpQLSdnLd4D7twDKh2W2oBpA3ijZMqbRF15ZLgkVff4MDEII-r1MQ/viewform';

/** 첫 앱 방문에서 냉장고가 비어 있던 사용자가 첫 식재료를 등록하면 1차 사용성 설문을 안내한다. */
export function UTConsentSheet({userId,initialIngredientCount}:{userId:string;initialIngredientCount:number}){
  const [open,setOpen]=useState(false);
  const tracking=useSurveyTracking(1);
  const form=new URL(SURVEY_URL);
  const entry=import.meta.env.VITE_UT_FIRST_SURVEY_ENTRY||'entry.443967875';
  if(tracking.code&&entry&&/^entry\.\d+$/.test(entry))form.searchParams.set(entry,tracking.code);
  const linked=Boolean(tracking.code&&entry&&/^entry\.\d+$/.test(entry));
  useEffect(()=>{
    if(!supabase)return;
    const firstVisitKey=`kokjipseo:ut-survey-first-visit:${userId}`;
    const pendingKey=`kokjipseo:ut-survey-pending:${userId}`;
    const shownKey=`kokjipseo:ut-survey-shown:${userId}`;
    let live=true,shown=false;
    try{
      // 첫 앱 방문에 냉장고가 비어 있으면 첫 식재료 등록까지 설문 표시를 대기한다.
      if(localStorage.getItem(firstVisitKey)!=='1'){
        localStorage.setItem(firstVisitKey,'1');
        if(initialIngredientCount===0)localStorage.setItem(pendingKey,'1');
      }
    }catch{/* 저장소를 사용할 수 없으면 현재 방문에서만 처리한다. */}
    const showAfterFirstRegistration=()=>{
      if(!live||shown||entrySource()==='email')return;
      let eligible=false;
      try{eligible=localStorage.getItem(pendingKey)==='1';}catch{eligible=initialIngredientCount===0;}
      if(!eligible)return;
      try{if(localStorage.getItem(shownKey)==='1')return;}catch{/* 계속 진행 */}
      // Participation consent is handled by UTWelcomeSheet. An active participant
      // must still receive the survey after their first registration.
      shown=true;
      try{localStorage.removeItem(pendingKey);}catch{/* 현재 화면 상태로 유지 */}
      try{localStorage.setItem(shownKey,'1');}catch{/* 현재 세션 중복만 막는다. */}
      setOpen(true);
    };
    const registered=()=>void showAfterFirstRegistration();
    window.addEventListener('kokjipseo:first-ingredient-registered',registered);
    // 등록 직후 새로고침된 경우에도 대기 중이던 표시를 이어간다.
    if(initialIngredientCount>0)void showAfterFirstRegistration();
    return()=>{live=false;window.removeEventListener('kokjipseo:first-ingredient-registered',registered);};
  },[userId]);
  if(!open)return null;
  return <OverlayDialog label="콕집서 1차 사용성 설문 안내" onOpen={tracking.onShown} onClose={()=>setOpen(false)} dismissOutside={false} className="ut-consent-sheet">
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
      {linked?<a className="action-button ut-survey-cta" href={form.href} target="_blank" rel="noreferrer" onClick={tracking.onClick}>1차 설문 참여하기</a>:<button className="action-button ut-survey-cta" disabled={!tracking.error} onClick={tracking.onShown}>{tracking.error?'설문 연결 다시 시도':'설문 연결 준비 중'}</button>}
      <p>설문 응답은 서비스 개선을 위해 활용됩니다.</p>
    </footer>
  </OverlayDialog>;
}
