import {HttpError, type Env} from './http.ts';

export type VerificationMail = {kind:'verification';to:string;code:string};
export type ReminderDigestMail = {kind:'reminder-digest';to:string;ingredients:{name:string;expiryDate:string;daysLeft:number;ingredientId:string;deliveryId:string}[]};
export type ReminderMail = {kind:'reminder';to:string;name:string;expiryDate:string;ingredientId:string;deliveryId:string;reminderType:string};
/** Future provider must honor the stable idempotency key, including after a worker crash. */
export type MailTransport = (mail:VerificationMail|ReminderMail|ReminderDigestMail,idempotencyKey:string)=>Promise<void>;
const origins=['https://younjeong-814.github.io',...['localhost','127.0.0.1'].flatMap(host=>[5173,5174,5175].map(port=>`http://${host}:${port}`))];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validEmail=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&!/[\r\n]/.test(value);
export async function hashVerification(owner:string,id:string,code:string,pepper:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${owner}:${id}:${code}:${pepper}`));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function randomCode(){let number:number;do{number=crypto.getRandomValues(new Uint32Array(1))[0];}while(number>=4294000000);return String(number%1000000).padStart(6,'0');}
function service(env:Env,fetcher:typeof fetch){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new HttpError(503,'알림 서버 설정을 준비 중이에요.');
  return async(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>{
    const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`,{method,
      headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY!,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok){
      const error=await response.json().catch(()=>({}));
      if(['resend_cooldown','request_limit'].includes(error?.message))throw new HttpError(429,'잠시 후 다시 요청해 주세요. 인증 메일 요청 횟수가 제한되어 있어요.');
      throw new HttpError(503,'알림 데이터를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    const value=await response.text();return value?JSON.parse(value):null;
  };
}
export function createVerificationHandler(env:Env,transport:MailTransport|null=null,fetcher:typeof fetch=fetch){
  return async(request:Request)=>{
    const origin=request.headers.get('Origin');
    const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin',
      'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
    const allowed=env.ALLOWED_ORIGINS?.split(',').map(v=>v.trim())??origins;
    if(origin&&allowed.includes(origin))headers.set('Access-Control-Allow-Origin',origin);
    const send=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
    if(origin&&!allowed.includes(origin))return send(403,{error:'허용되지 않은 사이트예요.'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return send(405,{error:'POST 요청만 지원해요.'});
    const auth=request.headers.get('Authorization');
    if(!auth?.startsWith('Bearer '))return send(401,{error:'임시 계정 연결을 확인해 주세요.'});
    try{
      if(!env.SUPABASE_URL||!(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY))throw new HttpError(503,'알림 서버 설정을 준비 중이에요.');
      const user=await fetcher(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:auth,apikey:(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY)!},signal:AbortSignal.timeout(10000)});
      if(!user.ok)throw new HttpError(401,'계정 연결이 만료됐어요. 다시 접속해 주세요.');
      const identity=await user.json();if(!identity?.id)throw new HttpError(401,'계정 연결을 확인해 주세요.');
      const raw=await request.text();if(raw.length>4096)throw new HttpError(413,'요청 내용이 너무 길어요.');
      let input;try{input=JSON.parse(raw);}catch{throw new HttpError(400,'입력 내용을 확인해 주세요.');}
      if(!input||typeof input!=='object')throw new HttpError(400,'입력 내용을 확인해 주세요.');
      if(input.action==='request-code'){
        if(typeof input.email!=='string'||!validEmail(input.email.trim())||input.consent!==true||input.consentVersion!=='email-reminders-v1')throw new HttpError(400,'이메일 주소와 알림 수신 동의를 확인해 주세요.');
        // Foundation only: no pretend sent/verified result when a provider is absent.
        if(!transport||!env.EMAIL_VERIFICATION_PEPPER)throw new HttpError(503,'이메일 발송 연결을 준비 중이에요. 아직 인증 메일은 보내지 않았어요.');
        const db=service(env,fetcher),id=crypto.randomUUID(),code=randomCode();
        const expiresAt=await db('rpc/create_email_change_request',{p_user_id:identity.id,p_id:id,p_email:input.email.trim(),p_hash:await hashVerification(identity.id,id,code,env.EMAIL_VERIFICATION_PEPPER)});
        try{await transport({kind:'verification',to:input.email.trim(),code},`verification:${id}`);}
        catch{await db(`email_change_requests?id=eq.${id}&user_id=eq.${identity.id}`,{delivery_status:'failed'},'PATCH');throw new HttpError(502,'인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.');}
        await db(`email_change_requests?id=eq.${id}&user_id=eq.${identity.id}`,{delivery_status:'sent'},'PATCH');
        return send(200,{requestId:id,expiresAt});
      }
      if(input.action==='verify-code'){
        if(!uuid.test(input.requestId)||!/^\d{6}$/.test(input.code))throw new HttpError(400,'인증번호 6자리를 입력해 주세요.');
        if(!env.EMAIL_VERIFICATION_PEPPER)throw new HttpError(503,'이메일 인증 연결을 준비 중이에요.');
        const result=await service(env,fetcher)('rpc/verify_email_change_request',{p_user_id:identity.id,p_id:input.requestId,p_hash:await hashVerification(identity.id,input.requestId,input.code,env.EMAIL_VERIFICATION_PEPPER)});
        if(!result?.ok)return send(400,{error:result?.reason==='expired'?'인증시간이 지났어요. 새 번호를 받아주세요.':result?.reason==='locked'?'인증 시도 횟수를 초과했어요. 새 번호를 받아주세요.':'인증번호를 확인해 주세요.',reason:result?.reason});
        return send(200,{ok:true});
      }
      throw new HttpError(400,'지원하지 않는 요청이에요.');
    }catch(error){return send(error instanceof HttpError?error.status:503,{error:error instanceof HttpError?error.message:'이메일 인증을 처리하지 못했어요. 다시 시도해 주세요.'});}
  };
}

/** Without a provider this ONLY plans jobs; it never claims attempts or marks anything sent. */
export function createReminderWorker(env:Env,transport:MailTransport|null=null,fetcher:typeof fetch=fetch,manual:string|false=false){
  return async(request:Request)=>{
    const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
    if(!env.EMAIL_CRON_SECRET||request.headers.get('x-cron-secret')!==env.EMAIL_CRON_SECRET)return reply(401,{error:'unauthorized'});
    try{
      const db=service(env,fetcher);const planned=await db(manual?'rpc/refresh_email_notification_schedule_for_user':'rpc/refresh_email_notification_schedule',manual?{p_user_id:manual}:{});
      if(!transport||env.EMAIL_DISPATCH_ENABLED!=='true')return reply(200,{mode:'planning-only',planned,sent:0});
      const jobs=await db('rpc/claim_email_digest_deliveries',{p_user_id:manual||null,p_manual:Boolean(manual)});
      let sent=0,failed=0,cancelled=0,sentIngredients=0;
      const groups=new Map<string,typeof jobs>();
      for(const job of jobs){
        if(manual&&job.user_id!==manual)throw new Error('cross_account_job_rejected');
        if(!job.digest_id)throw new Error('digest_id_required');
        const group=groups.get(job.digest_id)??[];group.push(job);groups.set(job.digest_id,group);
      }
      const users:Record<string,{sent:number;failed:number;cancelled:number}>={};
      for(const [digestId,group] of groups){
        const user=users[group[0].user_id]??={sent:0,failed:0,cancelled:0};
        const params={p_digest_id:digestId,p_lease:group[0].lease_token};
        if(group.some((job:any)=>job.user_id!==group[0].user_id||job.lease_token!==group[0].lease_token))throw new Error('invalid_digest_group');
        const current=await db('rpc/prepare_email_digest',params);
        if(!current?.ingredients?.length){cancelled+=group.length;user.cancelled+=group.length;continue;}
        if(current.userId!==group[0].user_id)throw new Error('cross_account_digest_rejected');
        const excluded=group.length-current.ingredients.length;cancelled+=excluded;user.cancelled+=excluded;
        try{await transport({kind:'reminder-digest',to:current.email,ingredients:current.ingredients},`reminder-digest:${digestId}`);}
        catch{await db('rpc/finish_email_digest',{...params,p_success:false});failed++;user.failed++;continue;}
        await db('rpc/finish_email_digest',{...params,p_success:true});sent++;sentIngredients+=current.ingredients.length;user.sent++;
      }
      return reply(200,{mode:'sending',planned,sent,failed,cancelled,sentIngredients,...(manual?{users}: {})});
    }catch{return reply(503,{error:'notification_worker_failed'});}
  };
}
