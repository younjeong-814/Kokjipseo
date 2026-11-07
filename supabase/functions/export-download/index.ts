// 안드로이드 인앱 브라우저에서 넘어온 외부 브라우저가 일회용 링크로 백업 파일을 받는다.
// 로그인 없이 토큰만으로 접근하므로 verify_jwt=false. 토큰은 5분 뒤 만료되고 한 번 받으면 삭제된다.
const env=Deno.env.toObject();
const page=(status:number,message:string)=>new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});

Deno.serve(async request=>{
  if(request.method!=='GET')return page(405,'지원하지 않는 요청이에요.');
  const token=new URL(request.url).searchParams.get('t')??'';
  if(!/^[0-9a-f]{64}$/.test(token))return page(400,'링크가 올바르지 않아요. 앱에서 다시 내보내기를 눌러 주세요.');
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return page(503,'서버 설정을 확인해 주세요.');
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/take_export_download`,{
    method:'POST',
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_token:token}),signal:AbortSignal.timeout(10000),
  }).catch(()=>null);
  if(!response?.ok)return page(503,'백업 파일을 불러오지 못했어요. 잠시 후 앱에서 다시 시도해 주세요.');
  const rows=await response.json().catch(()=>null);
  const row=Array.isArray(rows)?rows[0]:null;
  if(!row||typeof row.content!=='string')return page(410,'링크가 만료됐거나 이미 사용됐어요. 앱에서 다시 내보내기를 눌러 주세요.');
  return new Response(row.content,{headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition':`attachment; filename="${String(row.filename).replace(/[^A-Za-z0-9._-]/g,'')||'backup.json'}"`,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  }});
});
