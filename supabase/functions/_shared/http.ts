export type Env = Record<string,string|undefined>;
export class HttpError extends Error {constructor(public status:number,message:string){super(message)}}
const DEFAULT_ORIGINS=['https://younjeong-814.github.io','http://127.0.0.1:5173','http://127.0.0.1:5174','http://127.0.0.1:5175','http://localhost:5173'];
export function securedHandler(env:Env,kind:'recipes'|'ocr'|'recognize',method:'GET'|'POST',action:(request:Request)=>Promise<unknown>,fetcher:typeof fetch=fetch) {
  const allowed=(env.ALLOWED_ORIGINS?.split(',').map(s=>s.trim()).filter(Boolean)??DEFAULT_ORIGINS);
  return async(request:Request):Promise<Response>=>{
    const origin=request.headers.get('Origin');
    const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'});
    if(origin&&allowed.includes(origin))headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Access-Control-Allow-Headers','authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods',`${method}, OPTIONS`);
    const send=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
    if(origin&&!allowed.includes(origin))return send(403,{error:'허용되지 않은 사이트의 요청이에요.'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!==method)return send(405,{error:`${method} 요청만 지원해요.`});
    const auth=request.headers.get('Authorization');
    if(!auth?.startsWith('Bearer '))return send(401,{error:'Google 로그인 후 이용해 주세요.'});
    if(!env.SUPABASE_URL||!(env.SUPABASE_ANON_KEY||env.SUPABASE_PUBLISHABLE_KEY))return send(503,{error:'서버 인증 설정을 확인해 주세요.'});
    const authHeaders={Authorization:auth,apikey:(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY)!};
    try{
      const started=Date.now();
      // 사용자 확인과 한도 차감을 동시에 보낸다. RPC는 같은 JWT로 auth.uid()를 직접 검증하므로
      // 잘못된 토큰은 차감되지 않고, 외부 API는 두 결과를 모두 확인한 뒤에만 호출한다.
      const [user,quota]=await Promise.all([
        fetcher(`${env.SUPABASE_URL}/auth/v1/user`,{headers:authHeaders,signal:AbortSignal.timeout(10000)}),
        // A fixed database-enforced per-user budget prevents client-side resets.
        fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/consume_api_budget`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({api_kind:kind}),signal:AbortSignal.timeout(10000)}),
      ]);
      if(!user.ok)return send(401,{error:'로그인이 만료됐어요. 다시 로그인해 주세요.'});
      const identity=await user.json();if(!identity?.id)return send(401,{error:'로그인 정보를 확인하지 못했어요.'});
      if(!quota.ok)return send(503,{error:'서버 호출 제한 설정을 확인해 주세요.'});
      if(await quota.json()!==true)return send(429,{error:'오늘의 테스트 이용 횟수에 도달했어요. 내일 다시 이용해 주세요.'});
      const checked=Date.now();
      // 구간별 소요 시간만 남긴다. 키·이미지·사용자 정보는 기록하지 않는다.
      try{return send(200,await action(request));}
      finally{console.log(JSON.stringify({fn:kind,authBudgetMs:checked-started,actionMs:Date.now()-checked}));}
    }catch(error){
      if(error instanceof HttpError)return send(error.status,{error:error.message});
      // Never echo provider errors/URLs: some upstream APIs put credentials in URLs.
      return send(502,{error:'외부 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'});
    }
  };
}
export async function imageBody(request:Request):Promise<{image:string;mode?:string}> {
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'사진이 없어요.');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>6*1024*1024){await reader.cancel();throw new HttpError(413,'사진이 너무 커요. 크기를 줄여 다시 촬영해 주세요.')}chunks.push(part.value)}}finally{reader.releaseLock()}
  let data:any;try{const joined=new Uint8Array(size);let position=0;for(const chunk of chunks){joined.set(chunk,position);position+=chunk.byteLength}data=JSON.parse(new TextDecoder().decode(joined))}catch{throw new HttpError(400,'사진 요청 형식을 확인해 주세요.')}
  if(typeof data.image!=='string'||!data.image.startsWith('/9j/')||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.image))throw new HttpError(400,'JPEG 사진을 첨부해 주세요.');
  return {image:data.image,mode:data.mode};
}
