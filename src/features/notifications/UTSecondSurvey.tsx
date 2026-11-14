import { useEffect, useState } from 'react';
import { OverlayDialog } from '../../components/OverlayDialog';
import { supabase } from '../cloud/client';
import {useSurveyTracking} from './useSurveyTracking';
import surveyIcon from '../../assets/ut-survey/icon-survey.svg';
import closeIcon from '../../assets/ut-survey/icon-close.svg';
import noticeIcon from '../../assets/ut-survey/icon-exclamation.svg';

const surveyUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSd9j2zjGlG1aTxrKXypKnR2ztGbGpqyj1lkR4EE3KqtL7-sQA/viewform';
const entry = import.meta.env.VITE_UT_SECOND_SURVEY_ENTRY||'entry.1461618647';
const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const updatedEvent = 'kokjipseo:ingredient-status-updated';

export function notifyIngredientStatusUpdated() {
  window.dispatchEvent(new Event(updatedEvent));
}

export function UTSecondSurvey({ userId }: { userId: string }) {
  const [preview] = useState(() => import.meta.env.DEV
    ? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('survey-preview')
    : null);
  const [invitation, setInvitation] = useState<{ code: string | null; updated: boolean; digest?:string } | null>(() =>
    preview === 'updated' || preview === 'followup' ? { code: null, updated: preview === 'updated' } : null);
  const tracking=useSurveyTracking(2,invitation?.digest??null,!preview);
  useEffect(() => {
    const client = supabase;
    if (!client || preview === 'updated' || preview === 'followup') return;
    const shown = new Set<string>();
    const storageKey = `kokjipseo:second-survey-digest:${userId}`;
    let digest: string | null = null;
    let wasUpdated = false;
    let active = true;
    let request = 0;
    try {
      digest = sessionStorage.getItem(storageKey);
      wasUpdated = Boolean(digest && sessionStorage.getItem(`${storageKey}:${digest}:updated`));
    } catch { /* Keep the current tab in memory. */ }

    const check = async () => {
      if (!digest || !validId.test(digest)) return;
      const currentDigest = digest;
      const currentRequest = ++request;
      const updated = wasUpdated;
      const { data: code, error } = await client.rpc('get_ut_second_survey', { p_digest: currentDigest, p_updated: updated });
      if (!active || currentRequest !== request || error) return;
      if (!code) { setInvitation(null); return; }
      const shownKey = `${storageKey}:${currentDigest}:shown`;
      if (shown.has(currentDigest)) return;
      try {
        if (sessionStorage.getItem(shownKey)) return;
        sessionStorage.setItem(shownKey, '1');
      } catch { /* Prevent duplicate prompts in memory instead. */ }
      shown.add(currentDigest);
      setInvitation({ code, updated, digest:currentDigest });
    };
    const refresh = () => { void check().catch(() => {}); };
    const enter = () => {
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
      const next = params.get('digest');
      if (params.get('source') === 'email' && next && validId.test(next) && next !== digest) {
        digest = next;
        wasUpdated = false;
        setInvitation(null);
        try { sessionStorage.setItem(storageKey, digest); } catch { /* Keep the current tab in memory. */ }
      }
      refresh();
    };
    const update = () => {
      wasUpdated = true;
      // A new explicit management action may reopen an unanswered invitation.
      // Focus/visibility refreshes still do not repeatedly reopen the modal.
      if (digest) {
        shown.delete(digest);
        try {
          sessionStorage.setItem(`${storageKey}:${digest}:updated`, '1');
          sessionStorage.removeItem(`${storageKey}:${digest}:shown`);
        } catch { /* Keep the current tab in memory. */ }
      }
      refresh();
    };
    enter();
    window.addEventListener('hashchange', enter);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(updatedEvent, update);
    return () => {
      active = false;
      window.removeEventListener('hashchange', enter);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(updatedEvent, update);
    };
  }, [preview, userId]);

  if (!invitation) return null;
  const close = () => setInvitation(null);
  const form = new URL(surveyUrl);
  const linked=Boolean(tracking.code&&entry&&/^entry\.\d+$/.test(entry));
  if (tracking.code && entry && /^entry\.\d+$/.test(entry)) form.searchParams.set(entry, tracking.code);
  return <OverlayDialog label="콕집서 2차 사용성 설문 안내" onOpen={tracking.onShown} onClose={close} dismissOutside={false} className="ut-consent-sheet ut-second-survey">
    <div className="ut-survey-content" data-figma-node="6941:9521">
      <header className="ut-survey-header">
        <div>
          <p>{invitation.updated ? '식재료 등록 완료' : '소비기한 알림'}</p>
          <h2>{invitation.updated ? '식재료 상태 업데이트를 완료했어요!' : '2차 사용성 설문에 참여해 주세요'}</h2>
          <span>알림 메일을 받고 다시 이용한 경험은 어떠셨나요?</span>
        </div>
        <button type="button" aria-label="닫기" onClick={close}><img src={closeIcon} alt="" /></button>
      </header>
      <div className="ut-survey-cards">
        <section className="ut-survey-card">
          <div className="ut-survey-card-title"><img src={surveyIcon} alt="" /><strong>2차 알림 및 사용 경험 설문</strong></div>
          <p>소비기한 알림을 받은 뒤 식재료를 확인하고 관리하면서 경험한 내용을 알려주세요.</p>
          <span>총 7문항 · 약 3~5분</span>
        </section>
        <section className="ut-survey-followup"><img src={noticeIcon} alt="" /><p>좋았던 점 뿐 아니라 불편했던 점도 솔직하게 알려주세요.</p></section>
      </div>
    </div>
    <footer className="ut-survey-footer">
      {linked||preview?<a className="action-button ut-survey-cta" href={form.href} target="_blank" rel="noreferrer" onClick={()=>{tracking.onClick();close();}}>2차 설문 참여하기</a>:<button className="action-button ut-survey-cta" disabled={!tracking.error} onClick={tracking.onShown}>{tracking.error?'설문 연결 다시 시도':'설문 연결 준비 중'}</button>}
      <p>설문 응답은 서비스 개선을 위해 활용됩니다.</p>
    </footer>
  </OverlayDialog>;
}
