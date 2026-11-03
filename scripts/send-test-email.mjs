// 오전 9시를 기다리지 않고 소비 권장일 알림 메일을 바로 확인한다. DB에 쓰지 않고 Cron도 건드리지 않는다.
//   node scripts/send-test-email.mjs                 → 미리보기 HTML만 만든다
//   node scripts/send-test-email.mjs me@example.com  → .env.local의 RESEND_API_KEY / EMAIL_FROM으로 실제 발송
//   남은 일수는 3(기본)·1·0 중 하나: node scripts/send-test-email.mjs me@example.com 1
//   --gmail을 붙이면 Resend 대신 .env.local의 GMAIL_USER / GMAIL_APP_PASSWORD로 Gmail SMTP 발송
//   --from-db --user <Google 로그인 메일|user_id>: 예시 대신 내 냉장고 재료로 보낸다(DB는 읽기만, SUPABASE_SERVICE_ROLE_KEY 필요)
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
import nodemailer from 'nodemailer';

function load(path){
  const url=new URL(path,import.meta.url);const exports={};
  const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',code)(exports,p=>load(new URL(p,url)));return exports;
}
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const {renderReminderEmail}=load('../supabase/functions/_shared/emailTemplates.ts');
const {createResendTransport}=load('../supabase/functions/_shared/emailTransport.ts');

const args=process.argv.slice(2);
const flag=name=>args.includes(name);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const gmail=flag('--gmail'),fromDb=flag('--from-db'),userOption=option('--user');
const [to,days]=args.filter((arg,i)=>!arg.startsWith('--')&&args[i-1]!=='--user');
const REMINDER_TYPES={3:'3_days',1:'1_day',0:'due_today'};
const kstDate=offset=>new Date(Date.now()+offset*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});

// 남은 일수별 한 통씩. 실제 worker와 같은 조건(소비기한 D-3·D-1·당일, 남은 양 0% 제외)으로 고른다.
async function loadFridgeGroups(){
  const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key){console.error('.env.local에 VITE_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 넣어 주세요.');process.exit(1);}
  if(!userOption){console.error('--user 다음에 Google 로그인 메일 또는 user_id를 넣어 주세요.');process.exit(1);}
  const get=async path=>{const response=await fetch(`${url}${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});if(!response.ok)throw new Error(`Supabase ${response.status}: ${path.split('?')[0]}`);return response.json();};
  let userId=userOption;
  if(userOption.includes('@')){
    const users=[];for(let page=1;;page++){const {users:batch}=await get(`/auth/v1/admin/users?page=${page}&per_page=1000`);users.push(...batch);if(batch.length<1000)break;}
    const user=users.find(u=>u.email?.toLowerCase()===userOption.toLowerCase());
    if(!user){console.error(`${userOption}로 로그인한 계정을 찾지 못했어요. Google 계정을 연결했는지 확인해 주세요.`);process.exit(1);}
    userId=user.id;
  }
  const dates=Object.keys(REMINDER_TYPES).map(Number).map(d=>[d,kstDate(d)]);
  const rows=await get(`/rest/v1/ingredients?select=name,expiry_date,payload&user_id=eq.${encodeURIComponent(userId)}&expiry_date=in.(${dates.map(([,date])=>date).join(',')})`);
  const live=rows.filter(row=>String(row.payload?.remainingPercent??100)!=='0');
  console.log(`냉장고에서 알림 대상 ${live.length}개를 찾았어요.`);
  return dates.map(([daysLeft,date])=>({daysLeft,ingredients:live.filter(row=>row.expiry_date===date).map(row=>({name:row.name,expiryDate:row.expiry_date}))})).filter(group=>group.ingredients.length);
}

let groups;
if(fromDb)groups=await loadFridgeGroups();
else{
  const daysLeft=Number(days??3);
  if(!(daysLeft in REMINDER_TYPES)){console.error('남은 일수는 3, 1, 0 중 하나로 넣어 주세요.');process.exit(1);}
  groups=[{daysLeft,ingredients:[{name:'서울우유 1L',expiryDate:kstDate(daysLeft)}]}];
}
if(!groups.length){console.log('소비기한이 3일·1일 남았거나 오늘까지인 재료가 없어서 보낼 메일이 없어요.');process.exit(0);}

const digestIngredients=groups.flatMap(group=>group.ingredients.map(item=>({...item,daysLeft:group.daysLeft})));
mkdirSync('dist-email',{recursive:true});
writeFileSync('dist-email/reminder-preview.html',renderReminderEmail({to:to??'preview@example.com',ingredients:digestIngredients}).html);
console.log('미리보기: dist-email/reminder-preview.html');
if(!to)process.exit(0);

if(gmail){
  // 로컬 확인 전용. SMTP는 중복 방지 키가 없어 9시 worker에는 연결하지 않는다.
  const {GMAIL_USER:user,GMAIL_APP_PASSWORD:pass}=process.env;
  if(!user||!pass){console.error('.env.local에 GMAIL_USER와 GMAIL_APP_PASSWORD를 넣어 주세요.');process.exit(1);}
  const smtp=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass:pass.replaceAll(' ','')}});
  const message=renderReminderEmail({to,ingredients:digestIngredients});
  await smtp.sendMail({from:`콕집서 <${user}>`,to,subject:message.subject,html:message.html,text:message.text});
  console.log(`보냄: ${message.subject} (식재료 ${digestIngredients.length}개 · 1통)`);
}else{
  const transport=createResendTransport(process.env);
  if(!transport){console.error('.env.local에 RESEND_API_KEY와 EMAIL_FROM을 넣어 주세요.');process.exit(1);}
  await transport({kind:'reminder-digest',to,ingredients:digestIngredients.map((item,index)=>({...item,ingredientId:String(index),deliveryId:String(index)}))},`manual-test-digest:${Date.now()}`);
  console.log(`보냄: 식재료 ${digestIngredients.length}개 · 1통`);
