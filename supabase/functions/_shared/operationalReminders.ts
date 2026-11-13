import {createReminderWorker,validEmail,type MailTransport} from './emailNotifications.ts';
import type {Env} from './http.ts';

/** Server-only entry. A scoped diagnostic never enables general dispatch. */
export function createOperationalReminderHandler(env:Env,transport:MailTransport|null,fetcher:typeof fetch=fetch){
  return async(request:Request)=>{
    const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
    const cron=Boolean(env.EMAIL_CRON_SECRET&&request.headers.get('x-cron-secret')===env.EMAIL_CRON_SECRET);
    const admin=Boolean(env.SUPABASE_SERVICE_ROLE_KEY&&(request.headers.get('Authorization')===`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`||request.headers.get('x-reminder-admin')===env.SUPABASE_SERVICE_ROLE_KEY));
    if(!cron&&!admin)return reply(401,{error:'unauthorized'});
    let body:any;
    try{const raw=await request.text();if(raw.length>1024)return reply(413,{error:'too_large'});body=raw?JSON.parse(raw):{};}
    catch{return reply(400,{error:'invalid_request'});}
    if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'invalid_request'});
    if(body.action==='test'){
      if(!transport||!env.SUPABASE_URL||!validEmail(body.to)||!/^[0-9a-f-]{36}$/.test(body.requestId??''))return reply(400,{error:'invalid_test'});
      // Recipient must already have verified, enabled notification consent.
      const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/email_notification_settings?select=user_id&email=eq.${encodeURIComponent(body.to)}&enabled=eq.true&email_verified_at=not.is.null&consent_at=not.is.null&consent_version=eq.email-reminders-v1&limit=1`,{
        headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY!,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(10000)});
      if(!response.ok)return reply(503,{error:'recipient_check_failed'});
      const rows=await response.json();
      if(!Array.isArray(rows)||rows.length!==1)return reply(403,{error:'verified_recipient_required'});
      const date=(days:number)=>new Date(Date.now()+days*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
      try{
        await transport({kind:'reminder-digest',to:body.to,ingredients:[3,1,0].map((days,index)=>({
          name:`[발송 테스트] ${['대파','두부','우유'][index]}`,expiryDate:date(days),daysLeft:days,ingredientId:`test-${index}`,deliveryId:`test-${index}`,
        }))},`reminder-test:${body.requestId}`);
        return reply(200,{mode:'test',accepted:1,scheduledDispatchChanged:false});
      }catch{return reply(502,{error:'test_send_requires_review'});}
    }
    if(body.action&&body.action!=='run'&&body.action!=='inspect')return reply(400,{error:'unsupported_action'});
    if(!env.EMAIL_CRON_SECRET)return reply(503,{error:'scheduler_not_configured'});
    const settings=body.action==='inspect'?{...env,EMAIL_DISPATCH_ENABLED:'false'}:env;
    return createReminderWorker(settings,transport,fetcher)(new Request(request.url,{method:'POST',headers:{'x-cron-secret':env.EMAIL_CRON_SECRET}}));
  };
}
