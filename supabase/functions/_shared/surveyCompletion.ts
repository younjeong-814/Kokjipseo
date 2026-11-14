import type {Env} from './http.ts';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function createSurveyCompletionHandler(env:Env,fetcher:typeof fetch=fetch){
 return async(request:Request)=>{
  const reply=(status:number)=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='POST')return reply(405);
  if(!env.UT_SURVEY_SECRET||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return reply(503);
  if(request.headers.get('Authorization')!==`Bearer ${env.UT_SURVEY_SECRET}`)return reply(401);
  let input;
  try{const raw=await request.text();if(raw.length>2048)return reply(413);input=JSON.parse(raw);}catch{return reply(400);}
  if(![1,2].includes(input?.stage)||typeof input?.code!=='string'||!uuid.test(input.code)||typeof input?.responseId!=='string'||input.responseId.length<1||input.responseId.length>256)return reply(400);
  try{
   const result=await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/complete_ut_survey`,{method:'POST',
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_stage:input.stage,p_code:input.code,p_response_id:input.responseId}),signal:AbortSignal.timeout(10000)});
   if(!result.ok)return reply(502);
   return reply(await result.json()===true?204:422);
  }catch{return reply(502);}
 };
}
