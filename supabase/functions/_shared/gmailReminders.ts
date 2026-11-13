import type {Env} from './http.ts';
import {validEmail,type MailTransport} from './emailNotifications.ts';
import {EMAIL_APP_LINKS,renderReminderEmail} from './emailTemplates.ts';
import type {SmtpSend,SmtpMessage} from './gmail.ts';

/** Durable at-most-once SMTP attempts. Uncertain sends require manual review. */
export function createGmailReminderTransport(env:Env,send:SmtpSend|null=null,fetcher:typeof fetch=fetch):MailTransport|null{
  const user=env.GMAIL_USER?.trim(),password=env.GMAIL_APP_PASSWORD?.replaceAll(' ',''),sender=env.GMAIL_SENDER_EMAIL?.trim()||user;
  if(!user||!validEmail(user)||!password||!sender||!validEmail(sender)||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  let smtp:Promise<SmtpSend>|null=null;
  const deliver=()=>send?Promise.resolve(send):(smtp??=import('npm:nodemailer@6.9.16').then(module=>{
    const client=(module.default??module).createTransport({host:'smtp.gmail.com',port:465,secure:true,
      auth:{user,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
    return (message:SmtpMessage)=>client.sendMail(message);
  }));
  const rpc=async(name:string,body:unknown)=>{
    const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',
      headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY!,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('smtp_ledger_unavailable');
    return response.json();
  };
  return async(mail,key)=>{
    if(mail.kind!=='reminder-digest'||!validEmail(mail.to)||!mail.ingredients.length||
      !/^reminder-(?:digest|test):[0-9a-f-]{36}$/.test(key))throw new Error('invalid_reminder_digest');
    const fridgeUrl=key.startsWith('reminder-digest:')?`${EMAIL_APP_LINKS.fridge}&digest=${encodeURIComponent(key.slice(16))}`:EMAIL_APP_LINKS.fridge;
    const rendered=renderReminderEmail({to:mail.to,ingredients:mail.ingredients,fridgeUrl});
    const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rendered))))].map(v=>v.toString(16).padStart(2,'0')).join('');
    // Initialize the client before reserving; module load failures cannot submit mail.
    const smtpSend=await deliver();
    const args={p_key:key,p_fingerprint:fingerprint};
    const state=await rpc('reserve_email_smtp_attempt',args);
    if(state==='accepted')return;
    if(state!=='new')throw new Error('smtp_attempt_requires_review');
    try{
      const result=await smtpSend({from:{name:'콕집서',address:sender},to:mail.to,subject:rendered.subject,text:rendered.text,html:rendered.html});
      if(!result?.accepted?.some(value=>String(value).toLowerCase()===mail.to.toLowerCase()))throw new Error('not_accepted');
      if(await rpc('accept_email_smtp_attempt',args)!==true)throw new Error('acceptance_not_recorded');
    }catch{
      console.warn('gmail_reminder_requires_review');
      throw new Error('smtp_attempt_requires_review');
    }
  };
}
