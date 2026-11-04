import { useState } from 'react';
import { authRedirectUrl, supabase } from './client';
import { rememberAuthReturn } from './authReturn';
import { Snackbar } from '../../components/Snackbar';
import { ActionButton } from '../../components/ActionButton';
import { asset } from '../../lib/assets';

export function EmailReturnNotice({preview=false}:{preview?:boolean}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState<{id:number;message:string;success?:boolean}|null>({id:0,message:'재료를 등록했던 브라우저에서 다시 열어주세요.'});
  function notify(message:string, success=false) {setSnackbar({id:Date.now(),message,success});}
  async function copyLink() {
    try {
      const url=new URL(window.location.href);
      const [screen,query]=url.hash.slice(1).split('?');
      const params=new URLSearchParams(query);params.delete('preview');
      url.hash=`${screen}?${params}`;
      await navigator.clipboard.writeText(url.href);
      notify('링크를 복사했어요.',true);
    } catch {notify('주소창의 링크를 직접 복사해 주세요.');}
  }
  async function login() {
    if (preview) {notify('미리보기에서는 실제 로그인을 진행하지 않아요.');return;}
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      rememberAuthReturn();
      const { error } = await supabase.auth.signInWithOAuth({provider:'google', options:{redirectTo:authRedirectUrl(), scopes:'openid email profile', queryParams:{prompt:'select_account'}}});
      if (error) throw error;
    } catch { setError('로그인하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <div className="app-shell email-return-shell">
    <main className="email-return-page">
      <div className="email-return-intro">
        <span className="email-return-symbol" aria-hidden="true"><img src={asset('fridge-active.svg')} alt="" /></span>
        <h1>내 냉장고 기록을<br />다시 만나볼까요?</h1>
        <p>등록한 재료가 보이지 않는다면,<br />다른 브라우저로 열렸을 수 있어요.</p>
      </div>
      <section className="email-return-browser" aria-labelledby="email-browser-heading">
        <h2 id="email-browser-heading">등록한 재료가 있는 곳으로</h2>
        <ol><li><span>1</span>아래 버튼으로 링크를 복사해 주세요.</li><li><span>2</span>재료를 등록했던 브라우저를 열어주세요.</li><li><span>3</span>주소창에 붙여넣으면 확인할 수 있어요.</li></ol>
        <ActionButton type="button" onClick={()=>void copyLink()}>링크 복사하기</ActionButton>
      </section>
      <section className="email-return-google" aria-labelledby="email-google-heading">
        <h2 id="email-google-heading">Google 계정을 연결해 두셨나요?</h2>
        <p>식재료를 등록할 때 연결한 Google 계정으로<br />로그인하면 내 냉장고 기록을 불러올 수 있어요.</p>
        <button type="button" className="email-return-login" disabled={busy || (!supabase&&!preview)} onClick={()=>void login()}>{busy?'로그인 연결 중이에요':'기존 Google 계정으로 로그인'}<span aria-hidden="true">›</span></button>
      </section>
      <aside className="email-return-note"><span aria-hidden="true">i</span><p>이메일 알림만 신청하셨다면, 재료를 등록했던 브라우저에서 확인해 주세요.</p></aside>
      {preview && <button type="button" className="email-return-preview" onClick={()=>notify('재료를 등록했던 브라우저에서 다시 열어주세요.')}>스낵바 다시 보기</button>}
      {error && <p className="email-return-error" role="alert">{error}</p>}
    </main>
    {snackbar && <Snackbar key={snackbar.id} message={snackbar.message} variant={snackbar.success?'success':'default'} onDismiss={()=>setSnackbar(null)} />}
  </div>;
}
