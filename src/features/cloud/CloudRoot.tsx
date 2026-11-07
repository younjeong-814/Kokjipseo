import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { authRedirectUrl, supabase } from './client';
import { isEmailReturn, prepareEntrySession } from './emailReturn';
import { EmailReturnNotice } from './EmailReturnNotice';
import { rememberAuthReturn, rememberEmailTransfer, restoreAuthReturn, takeEmailTransfer } from './authReturn';
import { StorageContext } from './StorageContext';
import { CloudStorage, cacheKey, preservePendingBeforeReload } from './storage';
import { mergeSnapshots, parseBackup, snapshotKeys, validateSnapshot, type Snapshot } from './snapshot';
import { DataBackupSheet, type BackupResult, type UnsavedNotice } from './DataBackupSheet';
import { downloadInExternalBrowser, isAndroidInApp } from './externalDownload';
import { archiveLocalRecords, mergeGuestRecords, stashGuestRecords, takeGuestRecords, takeLocalRecords } from './guestTransfer';

import { AccountContext } from './AccountContext';
import { ConnectionStatusIcon } from '../../components/ConnectionStatusIcon';import { asset } from '../../lib/assets';
import {useNotificationSettings} from '../notifications/useNotificationSettings';
import {preferencesChanged} from '../notifications/client';
import {UTTracker,recordManagedActivity} from '../notifications/UTTracker';

const previewEmailReturn=import.meta.env.DEV && new URLSearchParams(window.location.hash.split('?')[1]??'').get('preview')==='email-return';
let reloginWithGoogle=restoreAuthReturn();
function download(name:string, value:string) {
  const url=URL.createObjectURL(new Blob([value],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
/** Figma 6841:25361 — 데이터 관리의 계정 저장 상태 배너(저장 중 · 저장 완료 · 저장 실패). */
type SyncBanner={tone:'loading'|'success'|'error';title:string;description:string;action?:{label:string;onClick:()=>void}};
type SaveErrorKind='offline'|'auth'|'conflict'|'failed';
function saveErrorKind(e:unknown):SaveErrorKind{
  const err=(e&&typeof e==='object'?e:{}) as {message?:unknown;code?:unknown;status?:unknown};
  const message=String(err.message??'');
  if(message.includes('revision_conflict'))return 'conflict';
  if(!navigator.onLine||e instanceof TypeError||/Failed to fetch|NetworkError|Load failed/i.test(message))return 'offline';
  if(err.code==='PGRST301'||err.status===401||/JWT|not authenticated/i.test(message))return 'auth';
  return 'failed';
}
/** onImport는 새로 추가된 기록 수를 돌려준다(0이면 파일의 기록이 이미 모두 있었다는 뜻). */
/** onExport는 파일을 바로 내려받았는지('download'), 외부 브라우저로 넘겼는지('external')를 돌려준다. */
type DataManagement={sync:SyncBanner;unsaved:UnsavedNotice|null;onExport:()=>Promise<'download'|'external'>;onImport:(file:File)=>Promise<number>};
const savedTime=new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit'});
const savedDate=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric'});
function formatSavedAt(date:Date){return `${date.toDateString()===new Date().toDateString()?'오늘':savedDate.format(date)} ${savedTime.format(date)}`;}
function AccountBar({session,data,children}: {session:Session|null;data?:DataManagement;children?:ReactNode}) {
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [backupOpen,setBackupOpen]=useState(false);
  const [importing,setImporting]=useState(false);
  // 백업 시트는 모달(top layer)이라 그 뒤 페이지에 쓴 안내가 가려진다. 결과는 시트를 연 채 시트 안 배너로 알린다.
  const [backupResult,setBackupResult]=useState<BackupResult|null>(null);
  const notifyBackup=(message:string)=>setBackupResult({tone:'success',message});
  const failBackup=(e:unknown,fallback:string)=>setBackupResult({tone:'error',message:e instanceof Error?e.message:fallback});
  const reminders=useNotificationSettings(session?.user.id);
  const reminderEmail=reminders.settings?.email_verified_at ? reminders.settings.email : '';
  const reminderEnabled=Boolean(reminders.settings?.enabled);
  const anonymous=Boolean(session?.user.is_anonymous);
  const connectGoogle=async()=>{
    if(!supabase || busy)return;
    setError('');setBusy(true);
    try {
      rememberAuthReturn();
      // 이미 다른 계정에 연결된 Google 계정으로 로그인하게 되더라도 신청한 알림 이메일을 이어받도록 티켓을 만든다.
      if(anonymous&&reminderEmail){const {data}=await supabase.rpc('start_email_settings_transfer');if(typeof data==='string')rememberEmailTransfer(data);}
      const options={redirectTo:authRedirectUrl(),scopes:'openid email profile'};
      const result=anonymous
        ? await supabase.auth.linkIdentity({provider:'google',options})
        : await supabase.auth.signInWithOAuth({provider:'google',options});
      if(result.error)throw result.error;
    }catch{setError('Google 계정을 연결하지 못했어요. 이미 연결된 계정이거나 연결 설정을 확인해야 할 수 있어요. 현재 기록은 자동으로 합치지 않아요.');}
    finally{setBusy(false);}
  };
  const signOut=async()=>{const {error}=await supabase!.auth.signOut({scope:'local'});if(error)setError('로그아웃하지 못했어요. 다시 시도해 주세요.')};
  const signedIn=Boolean(session && !anonymous);
  // 익명 계정에 Google을 연결하면 user_metadata·email이 바로 채워지지 않을 수 있어 Google identity 정보로 보완한다.
  const googleIdentity=session?.user.identities?.find(identity=>identity.provider==='google')?.identity_data;
  const displayName=String(session?.user.user_metadata.full_name||googleIdentity?.full_name||googleIdentity?.name||'나');
  const accountEmail=session?.user.email||(typeof googleIdentity?.email==='string'?googleIdentity.email:'');
  const notifications=<section className="settings-notifications" aria-labelledby="settings-notifications-title">
      <div className="settings-section-heading"><h2 id="settings-notifications-title">소비 권장일 알림</h2><p>소비 권장일이 다가오는 식재료를 이메일로 알려드려요.</p></div>
      {!reminders.loaded ? null : reminderEmail ? <div className="settings-email-preferences">
        <div className="settings-confirmed-email">
          <span>알림 받을 이메일</span>
          <div><strong>{reminderEmail}</strong><span className="settings-email-badge"><span className="settings-email-badge-icon"><img src={asset('status-success-mark.svg')} alt="" /></span>인증 완료</span></div>
        </div>
        <div className="settings-email-toggle-row">
          <span><strong>이메일 알림 받기</strong><small>소비 권장일 3일 전, 1일 전, 당일에 안내드려요.</small></span>
          <span className="settings-email-toggle-control"><span className={reminderEnabled ? 'is-on' : ''} aria-hidden="true">{reminderEnabled ? '켜짐' : '꺼짐'}</span><button type="button" className={`settings-email-toggle${reminderEnabled ? ' is-on' : ''}`} role="switch" aria-checked={reminderEnabled} aria-label="이메일 알림 받기" disabled={reminders.busy} onClick={()=>void reminders.toggle()}><span /></button></span>
        </div>
        <button type="button" className="settings-email-change" onClick={()=>window.dispatchEvent(new CustomEvent('kokjipseo:open-email-reminder', {detail: 'change'}))}>알림 이메일 변경<span className="settings-row-chevron" aria-hidden="true"><img src={asset('settings-row-chevron.svg')} alt="" /></span></button>
      </div> : <div className="settings-notice-card">
        <div className="settings-notice-copy"><span className="settings-round-icon" aria-hidden="true"><span className="settings-icon-slot"><img src={asset('notification-bell.svg')} alt="" /></span></span><div><strong>이메일로 알림을 받아보세요</strong><p>냉장고 속 식재료의 소비 권장일이<br />다가오면 이메일로 미리 알려드려요.</p></div></div>
        <button type="button" className="settings-email-button" onClick={()=>window.dispatchEvent(new Event('kokjipseo:open-email-reminder'))}>이메일로 알림 신청하기</button>
        <p className="settings-schedule"><img src={asset('detail-calendar.svg')} alt="" />소비 권장일 3일 전, 1일 전, 당일에 안내드려요.</p>
      </div>}
      {reminderEmail && !signedIn && <aside className="settings-notification-info"><span aria-hidden="true">i</span><div><strong>어떤 알림을 받나요?</strong><p>보관 중인 재료의 소비 권장일이 다가오면<br />이메일로 알려드려요. 소비 기록·상태 변경은<br />메일 알림으로 보내지 않아요.</p></div></aside>}
      {reminders.error&&<p role="alert">{reminders.error}<button type="button" onClick={()=>void reminders.reload()}>알림 설정 다시 불러오기</button></p>}
    </section>;
  // Figma 6416:7354 — Google 계정으로 로그인한 사용자(3번 사용자)의 설정 화면.
  if(signedIn && session && data) return <section className="cloud-account is-signed-in" aria-label="계정 및 데이터 관리">
    <div className="settings-profile"><span className="settings-avatar" aria-hidden="true">{displayName.slice(0,1)}</span><div className="settings-profile-copy"><span className="settings-section-label">내 계정</span><strong>{`${displayName}의 냉장고`}</strong>{accountEmail && <p className="account-email">{accountEmail}</p>}</div></div>
    {notifications}
    <section className="settings-data" aria-labelledby="settings-data-title">
      <h2 id="settings-data-title">데이터 관리</h2>
      <div className="settings-list-group">
        <div className={`settings-banner settings-sync-banner is-${data.sync.tone}`} role={data.sync.tone==='error'?'alert':'status'}>
          {data.sync.tone==='loading'
            ? <span className="settings-sync-spinner" aria-hidden="true"><img src={asset('sync-spinner-track.svg')} alt="" /><img src={asset('sync-spinner-arc.svg')} alt="" /></span>
            : <span className="settings-banner-status" aria-hidden="true"><img src={asset(data.sync.tone==='error'?'status-error-mark.svg':'status-success-mark.svg')} alt="" /></span>}
          <div className="settings-banner-copy"><p>{data.sync.title}</p>{data.sync.description && <small>{data.sync.description}</small>}</div>
          {data.sync.action && <button type="button" className="settings-banner-action" onClick={data.sync.action.onClick}>{data.sync.action.label}</button>}
        </div>
        <button type="button" className="settings-menu-item" onClick={()=>setBackupOpen(true)}>데이터 가져오기 및 내보내기<span className="settings-row-chevron" aria-hidden="true"><img src={asset('settings-row-chevron.svg')} alt="" /></span></button>
      </div>
    </section>
    <div className="settings-spacer" aria-hidden="true" />
    <div className="settings-logout-group"><button type="button" className="settings-logout" onClick={()=>void signOut()}>로그아웃</button></div>
    {error&&<p role="alert">{error}</p>}
    {backupOpen && <DataBackupSheet unsaved={data.unsaved} result={backupResult} busy={importing} onClose={()=>{setBackupOpen(false);setBackupResult(null);}} onExport={()=>{setBackupResult(null);data.onExport().then(
        how=>notifyBackup(how==='download'?'기록을 파일로 내보냈어요.':'외부 브라우저에서 파일을 내려받아 주세요.'),
        e=>failBackup(e,'백업 파일을 내보내지 못했어요.'))}} onImport={async file=>{
      setImporting(true);setBackupResult(null);
      try{const added=await data.onImport(file);notifyBackup(added>0?'기록을 불러왔어요.':'이미 모두 있는 기록이라 새로 불러온 내용이 없어요.');}
      catch(e){failBackup(e,'기록을 불러오지 못했어요.');}
      finally{setImporting(false);}
    }} />}
  </section>;
  return <section className="cloud-account" aria-label="계정 및 클라우드 저장">
    <div className={`settings-profile${reminderEmail ? ' is-reminder-active' : ''}`}><span className="settings-avatar" aria-hidden="true">{session && !anonymous ? String(session.user.user_metadata.full_name || '나').slice(0,1) : '콕'}</span><div className="settings-profile-copy"><span className="settings-section-label">{reminderEmail ? '이메일 알림 이용 중' : anonymous ? '로그인 없이 이용 중' : '내 계정'}</span><strong>{anonymous ? '임시 사용자의 냉장고' : session ? `${session.user.user_metadata.full_name || '나'}의 냉장고` : '내 냉장고를 다른 기기에서도 확인하세요'}</strong>
    <p className="settings-profile-status">{anonymous ? (reminderEmail ? 'Google 계정 미연결' : '계정 연결 전') : session ? '계정 연결됨' : '브라우저에 저장 중'}</p>{session?.user.email && <p className="account-email">{session.user.email}</p>}</div></div>
    {notifications}
    <section className="settings-records" aria-labelledby="settings-records-title">
      <h2 id="settings-records-title">내 기록 보관하기</h2>
      <div className="settings-record-card">
        <div className="settings-record-copy"><span className="settings-round-icon" aria-hidden="true"><span className="settings-icon-slot"><img src={asset('cloud-upload.svg')} alt="" /></span></span><p>이 브라우저에서 기록을 이용 중이에요.<br />Google 계정을 연결하면 다른 기기에서도<br className="settings-desktop-break" />내 냉장고를 이어서 사용할 수 있어요.</p></div>
        {!supabase ? <p className="settings-cloud-unavailable">클라우드 연결이 아직 설정되지 않았어요.</p> : session && !anonymous ? <button type="button" className="settings-google-button" onClick={()=>void signOut()}>로그아웃</button> : <button type="button" className="settings-google-button" disabled={busy} onClick={()=>void connectGoogle()}>{busy ? '연결 중이에요' : 'Google 계정 연결하기'}</button>}
      </div>
      {/* Figma 6449:7602 — 알림을 신청한 사용자 화면에는 기록 유지 안내가 없다. */}
      {!reminderEmail && <div className="settings-retention-note"><span aria-hidden="true">i</span><p>계정을 연결하기 전에 브라우저의 사이트 데이터를 삭제하면, 기존 기록을 다시 찾기 어려워요.</p></div>}
    </section>
    {error&&<p role="alert">{error}</p>}{children}
  </section>;
}
function SignedInStorage({session,children}:{session:Session;children:ReactNode}) {
  const [storage,setStorage]=useState<CloudStorage|null>(null);
  useEffect(()=>{
    if(session.user.is_anonymous)return;
    const token=takeEmailTransfer();
    if(token)void supabase!.rpc('claim_email_settings_transfer',{p_token:token}).then(({data})=>{if(data===true)preferencesChanged();});
  },[session.user.id,session.user.is_anonymous]);
  const [error,setError]=useState('');const [status,setStatus]=useState('불러오는 중이에요');
  const [retry,setRetry]=useState(0);
  const [conflict,setConflict]=useState(false);
  const [saving,setSaving]=useState(false);
  const [errorKind,setErrorKind]=useState<SaveErrorKind>('failed');
  // 백업 파일 실패는 저장 실패(error)와 섞이지 않게 따로 둔다.
  const [backupNotice,setBackupNotice]=useState('');
  // 충돌로 자동 저장을 멈춘 동안에도 저장하지 못한 개수가 갱신되도록 다시 그린다.
  const [,refresh]=useState(0);
  const savedAtKey=`${cacheKey(session.user.id)}.saved-at`;
  const [lastSavedAt,setLastSavedAt]=useState<Date|null>(()=>{try{const value=Date.parse(localStorage.getItem(savedAtKey)??'');return Number.isFinite(value)?new Date(value):null;}catch{return null;}});
  const trigger=useRef<()=>void>(()=>{});
  // 서버에 저장이 확인된 활동 기록. 여기에 없는 활동이 '저장하지 못한 기록'이다.
  const observed=useRef(new Set<string>());
  useEffect(()=>{
    let cancelled=false, running=false, stopped=false;let timer:ReturnType<typeof setTimeout>|undefined;
    let store:CloudStorage;
    const observedActivities=observed.current=new Set<string>();
    const schedule=()=>{if(cancelled)return;if(stopped){refresh(n=>n+1);return;}setStatus('저장 대기 중이에요');clearTimeout(timer);timer=setTimeout(()=>void flush(),350)};
    const flush=async()=>{
      if(cancelled||stopped||running||!store?.pending)return;
      running=true;setSaving(true);setStatus('클라우드에 저장 중이에요');
      const sent=store.snapshot();
      let succeeded=false;
      try {
        const {data,error}=await supabase!.rpc('save_fridge_snapshot',{expected_revision:store.revision,snapshot:sent});
        if(error)throw error;
        if(cancelled)return;
        store.acknowledge(data,sent);succeeded=true;setError('');setConflict(false);{const now=new Date();setLastSavedAt(now);try{localStorage.setItem(savedAtKey,now.toISOString());}catch{/* 표시용 시각만 잃는다. */}}setStatus(store.pending?'저장 대기 중이에요':'변경한 내용을 저장했어요');
        for(const raw of sent.activities){
          const activity=raw as {id:string;itemId:string;type:string};
          if(!observedActivities.has(activity.id)){
            observedActivities.add(activity.id);
            if(activity.type!=='registered')void recordManagedActivity(session.user.id,activity).catch(()=>{});
          }
        }
      } catch(e) {
        const kind=saveErrorKind(e),conflict=kind==='conflict';
        stopped=conflict;setConflict(conflict);setErrorKind(kind);
        setError(conflict?'다른 기기에서 데이터가 변경됐어요. 자동 덮어쓰기를 중단했어요. 이 기기 기록을 백업한 뒤 다시 연결해 주세요.':'클라우드 저장에 실패했어요. 이 기기에는 보관 중이며 재시도할 수 있어요.');
        setStatus('아직 서버에 저장되지 않았어요');
      } finally {running=false;if(!cancelled)setSaving(false);}
      if(!cancelled&&!stopped&&store.pending&&succeeded) schedule();
    };
    trigger.current=()=>{stopped=false;void flush()};
    void (async()=>{
      try {
        const {data,error}=await supabase!.rpc('load_fridge_snapshot');if(error)throw error;
        if(cancelled)return;
        store=new CloudStorage(localStorage,session.user.id,validateSnapshot(data),schedule);
        for(const raw of validateSnapshot(data).activities)observedActivities.add((raw as {id:string}).id);
        // 이미 있던 Google 계정으로 로그인했다면 직전 임시 계정의 기록을 합친다. 합친 결과는 미전송분으로 저장된다.
        if(!session.user.is_anonymous){const guest=takeGuestRecords(session.user.id);if(guest)mergeGuestRecords(store,guest);}
        // 계정 저장 전환 전 이 브라우저에 쌓인 기록(지난주·지난달 리포트 등)을 계정에 합친다. 예전 활동은 새 활동으로 다시 보내지 않는다.
        const local=takeLocalRecords();
        if(local){try{mergeGuestRecords(store,local);for(const raw of local.activities)observedActivities.add((raw as {id:string}).id);archiveLocalRecords();}catch{/* 합치지 못하면 원본을 남겨 다음 접속 때 다시 시도한다. */}}
        setStorage(store);setError('');setStatus(store.pending?'저장 대기 중이에요':'내 냉장고가 연결됐어요');if(store.pending)schedule();
      }catch{if(!cancelled)setError('계정 데이터를 불러오지 못했어요. DB 설정·연결을 확인해 주세요. 미전송 기록이 있다면 먼저 백업해 주세요.');}
    })();
    const retrySave=()=>{if(!stopped)void flush()};window.addEventListener('online',retrySave);
    return()=>{cancelled=true;clearTimeout(timer);window.removeEventListener('online',retrySave)};
  },[session.user.id,retry]);
  const backup=async():Promise<'download'|'external'>=>{
    const name='kokjipseo-cloud-backup.json',value=localStorage.getItem(cacheKey(session.user.id))??'{}';
    // 안드로이드 인앱 브라우저는 blob 다운로드가 막혀 외부 브라우저에서 받게 한다.
    if(isAndroidInApp()){await downloadInExternalBrowser(name,value);return 'external';}
    download(name,value);return 'download';
  };
  const reloadRemote=()=>{try{preservePendingBeforeReload(localStorage,session.user.id);setStorage(null);setError('');setConflict(false);setRetry(n=>n+1)}catch{setError('미전송 기록을 별도 보관하지 못했어요. 먼저 파일로 백업해 주세요.')}};
  if(!storage) return <main className="cloud-account"><p role={error?'alert':'status'}>{error||'계정의 냉장고를 불러오는 중이에요'}</p>{error&&<><button onClick={()=>void backup().catch(e=>setError(e instanceof Error?e.message:'백업 파일을 내보내지 못했어요.'))}>이 기기 기록 백업</button><button onClick={()=>setRetry(n=>n+1)}>다시 연결</button><button onClick={reloadRemote}>미전송 기록 별도 보관 후 서버 다시 불러오기</button>{!session.user.is_anonymous && <button onClick={()=>void supabase!.auth.signOut({scope:'local'})}>로그아웃</button>}</>}</main>;
  const unsavedCount=storage.pending?storage.snapshot().activities.filter(raw=>!observed.current.has((raw as {id:string}).id)).length:0;
  // 다른 기기와 충돌하면 재시도가 계속 실패하므로 '다시 시도'는 미전송 기록을 보관한 뒤 서버 기록을 다시 불러온다.
  const retrySave=conflict?reloadRemote:()=>trigger.current();
  // 아직 계정에 저장되지 않은 활동의 식재료 수(같은 식재료의 여러 활동은 하나로 센다).
  const unsavedItems=new Set(storage.pending?storage.snapshot().activities.filter(raw=>!observed.current.has((raw as {id:string}).id)).map(raw=>(raw as {itemId:string}).itemId):[]).size;
  const relogin=()=>{rememberAuthReturn();void supabase!.auth.signInWithOAuth({provider:'google',options:{redirectTo:authRedirectUrl(),scopes:'openid email profile'}}).then(({error})=>{if(error)setError('Google 계정에 다시 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.');});};
  const retryAction={label:'다시 시도',onClick:()=>trigger.current()};
  const savedAtText=lastSavedAt?formatSavedAt(lastSavedAt):'';
  const errorBanner:Record<SaveErrorKind,{title:string;action:SyncBanner['action']}>={
    offline:{title:'인터넷 연결을 확인해 주세요.',action:retryAction},
    auth:{title:'Google 계정을 다시 연결해 주세요.',action:{label:'다시 로그인',onClick:relogin}},
    conflict:{title:'다른 기기에서 변경된 기록이 있어요.',action:{label:'기록 확인',onClick:reloadRemote}},
    failed:{title:unsavedItems>0?`식재료 ${unsavedItems}개가 계정에 저장되지 않았어요.`:'변경 내용을 저장하지 못했어요.',action:retryAction},
  };
  // 저장 완료는 서버 확인(불러오기·저장 응답) 후에만 보여준다. 저장 대기·저장 중·다시 시도 중에는 진행 상태를 보여준다.
  const sync:SyncBanner=saving||(!error&&storage.pending)
    ? {tone:'loading',title:'식재료 기록을 계정에 저장하고 있어요.',description:'잠시만 기다려 주세요'}
    : error
      ? {tone:'error',...errorBanner[errorKind],description:`이 기기에는 남아있어요${savedAtText?` · ${savedAtText}`:''}`}
      : {tone:'success',title:'모든 식재료 기록을 계정에 저장했어요.',description:savedAtText?`마지막 저장 · ${savedAtText}`:''};
  const backupFailed=(e:unknown)=>setBackupNotice(e instanceof Error?e.message:'백업 파일을 내보내지 못했어요.');
  const importBackup=async(file:File)=>{
    const current=storage.snapshot();
    // 같은 id는 현재 기록을 우선해 가져오기가 최근 변경을 덮어쓰지 않게 한다.
    const merged=mergeSnapshots(current,parseBackup(await file.text()));
    const added=(Object.keys(snapshotKeys) as (keyof Snapshot)[]).reduce((sum,k)=>sum+merged[k].length-current[k].length,0);
    if(added)for(const k of Object.keys(snapshotKeys) as (keyof Snapshot)[])storage.setItem(snapshotKeys[k],JSON.stringify(merged[k]));
    return added;
  };
  const data={sync,unsaved:error?{count:unsavedCount,onRetry:retrySave}:null,onExport:backup,onImport:importBackup};
  if(isEmailReturn(window.location.hash) && storage.snapshot().ingredients.length===0)return <EmailReturnNotice />;
  return <StorageContext.Provider value={storage}>
    <AccountContext.Provider value={<AccountBar session={session} data={data}>
      <div className={`settings-sync-status${error ? ' has-error' : ''}`}>
        {error || !storage.pending ? <ConnectionStatusIcon error={Boolean(error)} /> : null}
        <p role={error ? 'alert' : 'status'}>{error || status}</p>
      </div><h2 className="settings-section-title">데이터 관리</h2><div className="settings-data-actions">
      <button onClick={()=>trigger.current()}>저장 재시도</button>
      <button onClick={()=>{setBackupNotice('');void backup().catch(backupFailed);}}>이 기기 기록 백업</button>
      {error&&<button onClick={reloadRemote}>미전송 기록 별도 보관 후 서버 다시 불러오기</button>}
      {backupNotice&&<p role="alert">{backupNotice}</p>}
    </div></AccountBar>}>
    {children}
    <UTTracker userId={session.user.id}/>
    {error&&<aside className="cloud-save-warning" role="alert">{error}<button onClick={()=>{setBackupNotice('');void backup().catch(backupFailed);}}>기록 백업</button>{backupNotice&&<p>{backupNotice}</p>}</aside>}
    </AccountContext.Provider>
  </StorageContext.Provider>;
}
export function CloudRoot({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null);
  const [ready,setReady]=useState(!supabase);const [error,setError]=useState('');
  const initialize=useCallback(async()=>{
    if(!supabase)return;
    setError('');setReady(false);
    if(reloginWithGoogle){
      // 이미 다른 계정에 연결된 Google 계정이면 연결 대신 그 계정으로 로그인하고, 임시 계정의 기록은 로그인 후 합친다.
      reloginWithGoogle=false;
      const {data:{session:guest}}=await supabase.auth.getSession();
      let stashed=!guest?.user.is_anonymous;
      if(guest?.user.is_anonymous){try{await stashGuestRecords(guest.user.id,async()=>{const {data,error}=await supabase!.rpc('load_fridge_snapshot');if(error)throw error;return data;});stashed=true;}catch{/* 옮길 기록을 확인하지 못하면 임시 계정에 머문다. */}}
      if(stashed){rememberAuthReturn();
      const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:authRedirectUrl(),scopes:'openid email profile'}});
      if(!error)return;}
    }
    try{setSession(await prepareEntrySession(supabase,isEmailReturn(window.location.hash)));
    }catch{setError('임시 계정을 준비하지 못했어요. 연결 상태와 Supabase 익명 로그인 설정을 확인한 뒤 다시 시도해 주세요. 기존 기록은 그대로 보관돼요.');}
    finally{setReady(true);}
  },[]);
  useEffect(()=>{
    if(!supabase||previewEmailReturn)return;void initialize();
    const {data}=supabase.auth.onAuthStateChange((event,next)=>{
      if(next){setSession(next);setReady(true);setError('');}
      else if(event==='SIGNED_OUT'){
        setSession(null);setReady(false);
        // Run outside the auth callback's internal lock.
        setTimeout(()=>void initialize(),0);
      }
    });
    return()=>data.subscription.unsubscribe();
  },[initialize]);
  if(previewEmailReturn)return <EmailReturnNotice preview />;
  if(!ready)return <main className="cloud-account" role="status">로그인 상태를 확인하고 있어요</main>;
  if(supabase && !session && !error && isEmailReturn(window.location.hash))return <EmailReturnNotice />;
  if(supabase && !session)return <main className="cloud-account"><p role="alert">{error}</p><button onClick={()=>void initialize()}>다시 시도</button></main>;
  if(session)return <SignedInStorage key={session.user.id} session={session}>{children}</SignedInStorage>;
  return <StorageContext.Provider key="guest" value={null}><AccountContext.Provider value={<AccountBar session={null}></AccountBar>}>{error&&<p role="alert">{error}</p>}{children}</AccountContext.Provider></StorageContext.Provider>;
}
