import type {Env} from './http.ts';
import type {MailTransport} from './emailNotifications.ts';
import {renderReminderEmail} from './emailTemplates.ts';

const DAYS_LEFT:Record<string,number>={'3_days':3,'1_day':1,'due_today':0};

/** Resend adapter. Returns null until both secrets exist, so the worker stays planning-only. */
export function createResendTransport(env:Env,fetcher:typeof fetch=fetch):MailTransport|null{
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return null;
  return async(mail,idempotencyKey)=>{
    if(mail.kind!=='reminder'&&mail.kind!=='reminder-digest')throw new Error('unsupported_mail_kind');
    const message=renderReminderEmail({to:mail.to,ingredients:mail.kind==='reminder-digest'?mail.ingredients:[{name:mail.name,expiryDate:mail.expiryDate,daysLeft:DAYS_LEFT[mail.reminderType]}]});
    const response=await fetcher('https://api.resend.com/emails',{method:'POST',
      // Resend deduplicates the same key for 24h, so a retried delivery is not sent twice.
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
      body:JSON.stringify({from:env.EMAIL_FROM,to:[message.to],subject:message.subject,html:message.html,text:message.text}),
      signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`provider_${response.status}`);
  };
}
