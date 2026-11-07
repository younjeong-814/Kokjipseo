import {useEffect,useRef,useState} from 'react';
import {OverlayDialog} from '../../components/OverlayDialog';
import {asset} from '../../lib/assets';
import {isEmail,requestEmailCode,verifyEmailCode} from '../notifications/client';
type Step='email'|'code'|'expired'|'success';
function EmailReminderField({
  id,
  label,
  placeholder,
  value,
  helperText,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  helperText?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const filled = Boolean(value);

  return <div className="email-reminder-field-group">
    <label htmlFor={id}>{label}</label>
    <div className={`email-reminder-input${filled ? ' is-filled' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input
        id={id}
        type={id === 'reminder-email' ? 'email' : 'text'}
        autoComplete={id === 'reminder-email' ? 'email' : 'one-time-code'}
        inputMode={id === 'reminder-code' ? 'numeric' : 'email'}
        maxLength={id === 'reminder-email' ? 254 : 6}
        autoFocus
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={event => onChange(event.target.value)}
      />
      {focused && filled && !disabled && <button
        type="button"
        className="email-reminder-clear"
        aria-label={`${label} 지우기`}
        onMouseDown={event => event.preventDefault()}
        onClick={() => onChange('')}
      ><img src={asset('search-clear.svg')} alt="" /></button>}
    </div>
    {helperText && <p className="email-reminder-field-helper">{helperText}</p>}
  </div>;
}

export function EmailReminderModal({onClose, mode = 'apply'}:{onClose:()=>void; mode?: 'apply' | 'change'}){
  const [step,setStep]=useState<Step>('email'),[email,setEmail]=useState(''),[code,setCode]=useState('');
  const [consent,setConsent]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [requestId,setRequestId]=useState(''),[deadline,setDeadline]=useState<number|null>(null),[secondsLeft,setSecondsLeft]=useState(300);
  const working=useRef(false);
  useEffect(()=>{
    if(deadline===null||step!=='code')return;
    const update=()=>{const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));setSecondsLeft(left);if(!left)setStep('expired');};
    update();const timer=window.setInterval(update,500);return()=>window.clearInterval(timer);
  },[deadline,step]);
  const requestCode=async()=>{
    if(working.current)return;
    if(!isEmail(email.trim())||!consent){setError('이메일 주소와 알림 수신 동의를 확인해 주세요.');return;}
    working.current=true;setBusy(true);setError('');
    try{const result=await requestEmailCode(email.trim());setRequestId(result.requestId);setCode('');setDeadline(Date.parse(result.expiresAt));setStep('code');}
    catch(e){setError(e instanceof Error?e.message:'인증 메일을 요청하지 못했어요.');}
    finally{working.current=false;setBusy(false);}
  };
  const verify=async()=>{
    if(working.current||!/^\d{6}$/.test(code))return;
    if(deadline===null||Date.now()>=deadline){setStep('expired');return;}
    working.current=true;setBusy(true);setError('');
    try{await verifyEmailCode(requestId,code);setStep('success');}
    catch(e){setError(e instanceof Error?e.message:'인증번호를 확인해 주세요.');}
    finally{working.current=false;setBusy(false);}
  };
  const emailTitle = mode === 'change' ? '알림 이메일 변경' : '알림 이메일 신청';
  const title=step==='email'?emailTitle:step==='expired'?'인증시간이 지났어요':step==='success'?'이메일 인증이 완료됐어요':'이메일을 확인해 주세요';
  return <OverlayDialog label={title} onClose={onClose} className="email-reminder-dialog">
    <div className="email-reminder-content">
      <div className="email-reminder-heading"><div><h2>{title}</h2><p>{step==='email'?'소비 권장일 알림을 받을 이메일 주소를 알려주세요.':step==='expired'?'새 인증번호를 받아 이메일 인증을 이어가 주세요.':step==='success'?'인증한 이메일로 알림을 받을 수 있어요.':`${email.trim()}으로 인증번호를 보냈어요.`}</p></div>
        <button type="button" className="email-reminder-close" aria-label="닫기" onClick={onClose}><img src={asset('modal-close.svg')} alt=""/></button></div>
      {step==='success'?<div className="email-reminder-success"><span className="email-reminder-success-icon" aria-hidden="true"><i/></span><strong>{email.trim()}</strong><p>소비 권장일 3일 전, 1일 전, 당일 오전 9시에 알림을 안내드려요.</p><small>알림 받을 이메일은 설정에서 변경할 수 있어요.</small></div>
      :<div className="email-reminder-fields">
        {step==='email'?<>
          <EmailReminderField id="reminder-email" label="알림 받을 이메일" placeholder="이메일 주소를 입력해 주세요" value={email} disabled={busy} onChange={value=>{setEmail(value);setError('');}}/>
          <label className="email-reminder-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>소비 권장일 이메일 알림 수신에 동의해요.<small>알림은 설정에서 언제든 끌 수 있어요.</small></span></label>
          <p>새 이메일 인증이 끝나기 전에는 기존 알림 주소를 유지해요. Google 로그인 계정은 변경되지 않아요.</p>
        </>:<>
          <EmailReminderField id="reminder-code" label="인증번호" placeholder="숫자 6자리 입력" value={code} disabled={step==='expired'||busy} onChange={value=>{setCode(value.replace(/\D/g,'').slice(0,6));setError('');}}/>
          <p className={step==='expired'?'email-reminder-error':'email-reminder-timer'}>{step==='expired'?'인증번호가 만료됐어요. 새 번호를 받아주세요.':`인증번호 유효시간 ${String(Math.floor(secondsLeft/60)).padStart(2,'0')}:${String(secondsLeft%60).padStart(2,'0')}`}</p>
          <div className="email-reminder-links"><button type="button" disabled={busy} onClick={()=>{setStep('email');setCode('');setDeadline(null);setError('');}}>이메일 주소 수정</button><button type="button" disabled={busy} onClick={()=>void requestCode()}>인증번호 다시 받기</button></div>
          <p>메일이 보이지 않으면 스팸함도 확인해 주세요.</p>
        </>}
      </div>}
      {error&&<p className="email-reminder-error email-reminder-server-error" role="alert">{error}</p>}
      <footer className="email-reminder-footer">{step==='success'?<button type="button" onClick={onClose}>확인</button>:<button type="button" disabled={busy||(step==='email'?(!isEmail(email.trim())||!consent):step==='code'?!/^\d{6}$/.test(code):false)} onClick={()=>void(step==='code'?verify():requestCode())}>{busy?'처리 중이에요':step==='email'?'인증번호 받기':step==='expired'?'인증번호 다시 받기':'인증하고 알림 받기'}</button>}</footer>
    </div>
  </OverlayDialog>;
}
