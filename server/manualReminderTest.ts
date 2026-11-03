import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createManualReminderTest } from '../supabase/functions/_shared/manualReminderTest';
import { createResendTransport } from '../supabase/functions/_shared/emailTransport';
import { renderReminderEmail } from '../supabase/functions/_shared/emailTemplates';
import type { MailTransport } from '../supabase/functions/_shared/emailNotifications';

/** Local SMTP tests use a durable attempt record. An uncertain send is never retried automatically. */
export function createLocalTestTransport(env:Record<string,string>,options:{directory?:string;send?:(message:Record<string,string>)=>Promise<unknown>}={}):MailTransport|null {
  if(!env.GMAIL_USER||!env.GMAIL_APP_PASSWORD)return null;
  return async(mail,key)=>{
    if(mail.kind!=='reminder'&&mail.kind!=='reminder-digest')throw new Error('reminder_only');
    const directory=options.directory??'.local-mail-attempts';
    mkdirSync(directory,{recursive:true});
    const file=`${directory}/${createHash('sha256').update(key).digest('hex')}.json`;
    const fingerprint=createHash('sha256').update(JSON.stringify(mail)).digest('hex');
    try { const previous=JSON.parse(readFileSync(file,'utf8'));if(previous.accepted&&previous.fingerprint===fingerprint)return; throw new Error('uncertain_previous_attempt'); }
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('previous_attempt_requires_review');}
    writeFileSync(file,JSON.stringify({accepted:false,fingerprint}),{flag:'wx'});
    const days:Record<string,number>={'3_days':3,'1_day':1,'due_today':0};
    const message=renderReminderEmail({to:mail.to,ingredients:mail.kind==='reminder-digest'?mail.ingredients:[{name:mail.name,expiryDate:mail.expiryDate,daysLeft:days[mail.reminderType]}]});
    const send=options.send??((value:Record<string,string>)=>createRequire(import.meta.url)('nodemailer').createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:env.GMAIL_USER,pass:env.GMAIL_APP_PASSWORD.replaceAll(' ','')},connectionTimeout:10000,socketTimeout:20000}).sendMail(value));
    await send({from:`콕집서 <${env.GMAIL_USER}>`,to:mail.to,subject:message.subject,html:message.html,text:message.text});
    writeFileSync(file,JSON.stringify({accepted:true,fingerprint}));
  };
}
export function manualReminderTestMiddleware(values:Record<string,string>) {
  // The automatic dispatch flag is overridden only inside this local test handler.
  const env={...values,SUPABASE_URL:values.SUPABASE_URL||values.VITE_SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:values.VITE_SUPABASE_PUBLISHABLE_KEY,
    EMAIL_CRON_SECRET:'local-internal-only',EMAIL_DISPATCH_ENABLED:values.EMAIL_MANUAL_TEST_ENABLED==='true'?'true':'false'};
  const handler=createManualReminderTest(env,createResendTransport(env)??createLocalTestTransport(values));
  return async(req:IncomingMessage,res:ServerResponse)=>{
    const reply=(status:number,body:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return reply(403,{error:'로컬 테스트에서만 사용할 수 있어요.'});
    try {
      let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>256)return reply(413,{error:'요청이 너무 길어요.'});}
      const headers=new Headers();for(const name of ['authorization','origin','content-type']){const value=req.headers[name];if(typeof value==='string')headers.set(name,value);}
      const response=await handler(new Request('http://127.0.0.1/api/email-reminder-test',{method:req.method,headers,body:req.method==='POST'?body:undefined}));
      res.statusCode=response.status;response.headers.forEach((value,name)=>res.setHeader(name,value));res.end(await response.text());
    }catch{return reply(503,{error:'로컬 테스트 서버 연결을 확인해 주세요. 일부 발송이 완료됐을 수 있으니 결과를 확인한 뒤 다시 검사해 주세요.'});}
  };
}
