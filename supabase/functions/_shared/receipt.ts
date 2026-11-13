// 영수증 OCR 줄을 Gemini로 품목 목록으로 정리한다. 영수증마다 다른 줄 형식(바코드 줄 분리, 금액 뒤 과세 표시 등)을
// 규칙으로 일일이 맞추지 않기 위해서다. 실패하면 호출한 쪽이 규칙 파서(parseReceipt)로 처리한다.
// 모델이 읽지 않은 품목을 지어내지 않도록 품목마다 상품명이 적힌 줄 번호를 받아 실제 줄과 대조한다.
import {thinkingConfig} from './photo.ts';
import {groupRows,type OcrWord,type ReceiptItem} from './generated/receiptParse.ts';

const MAX_LINES=150;
const MAX_LINE_LENGTH=100;
const MAX_ITEMS=80;
const STRUCTURING_BUDGET_MS=5000;

const PROMPT=[
  '아래는 마트 영수증을 OCR로 읽은 줄 목록이다. 각 줄 앞의 숫자는 줄 번호다.',
  '구매한 식품 품목만 뽑아라.',
  '- 상품명 줄 아래에 바코드·수량·단가·금액이 따로 찍히는 영수증이 많다. 두 줄을 한 품목으로 묶어라.',
  '- 금액 뒤의 s, S, *, # 는 과세·면세 표시다. 품목 여부와 상관없다.',
  '- 할인·쿠폰·봉투·포인트·합계·결제·매장 정보·안내 문구 줄은 품목이 아니다. 비식품(세제·휴지·약 등)과 주류도 빼라.',
  "- name: 브랜드·용량·중량·개수·코드·기호를 빼고 무엇인지 알 수 있는 짧은 한국어 이름. 예) '백설콩식용유1.8L'→'콩식용유', '곰표튀김가루1kg'→'튀김가루', '광천돌자반(플레인)40g'→'돌자반', '미닛메이드제주감귤1.5L'→'감귤주스'.",
  "  브랜드를 빼면 무엇인지 알 수 없는 상품(과자·라면 등)은 상품 이름을 남겨라. 예) 'N)고래밥볶음4P2700'→'고래밥'.",
  '- quantity: 수량 열의 값. 무게로 파는 상품(예: 992g)이나 수량이 안 보이면 1.',
  '- line: 그 품목의 상품명이 적힌 줄 번호.',
  '- 줄 목록에 없는 상품을 만들지 마라. OCR 오타는 명백할 때만 고쳐라.',
  '품목이 없으면 items는 빈 배열이다.',
].join('\n');

const SCHEMA={type:'object',properties:{items:{type:'array',maxItems:MAX_ITEMS,items:{type:'object',properties:{name:{type:'string'},quantity:{type:'integer'},line:{type:'integer'}},required:['name','quantity','line'],additionalProperties:false}}},required:['items'],additionalProperties:false};

const compact=(text:string)=>text.toLowerCase().replace(/[^\p{Script=Hangul}a-z0-9]/gu,'');

/** 이름의 두 글자 조각이 하나라도 그 줄(앞뒤 줄 포함)에 있으면 줄에서 읽은 이름으로 본다. 감귤주스처럼 바꾼 이름도 '감귤'로 통과한다. */
export function groundedIn(name:string,line:string):boolean{
  const a=compact(name),b=compact(line);
  if(a.length<2)return false;
  for(let i=0;i+2<=a.length;i++)if(b.includes(a.slice(i,i+2)))return true;
  return false;
}

/** Gemini 응답을 검사해 품목으로 바꾼다. 형식이 틀리면 throw, 없는 줄을 가리키는 품목은 버린다. */
export function parseReceiptItems(value:unknown,lines:string[]):ReceiptItem[]{
  const data=value as {items?:unknown[]};
  if(!data||!Array.isArray(data.items)||data.items.length>MAX_ITEMS)throw new Error('invalid receipt result');
  const items=new Map<string,ReceiptItem>();
  for(const raw of data.items){
    const item=raw as {name?:unknown;quantity?:unknown;line?:unknown};
    if(!item||typeof item.name!=='string'||!Number.isInteger(item.quantity)||!Number.isInteger(item.line))throw new Error('invalid receipt item');
    const name=item.name.replace(/\s+/g,' ').trim().slice(0,60);
    const index=item.line as number;
    if(!name||!/\p{Script=Hangul}/u.test(name)||lines[index]===undefined)continue;
    // OCR이 상품명 하나를 두 줄로 나누는 경우(백설 콩 / 식용유 1.8L)가 있어 앞뒤 줄까지 함께 본다.
    const line=lines.slice(Math.max(0,index-1),index+2).join(' ');
    const quantity=Math.min(100,Math.max(1,item.quantity as number));
    const existing=items.get(name);
    if(existing)existing.quantity+=quantity;
    else items.set(name,{name,quantity,suspicious:!groundedIn(name,line)});
  }
  return [...items.values()];
}

export async function structureReceipt(key:string,model:string,lines:string[],fetcher:typeof fetch=fetch):Promise<ReceiptItem[]>{
  if(!/^gemini-[a-zA-Z0-9.-]+$/.test(model))throw new Error('invalid model');
  const rows=lines.slice(0,MAX_LINES).map(line=>line.slice(0,MAX_LINE_LENGTH));
  const text=`${PROMPT}\n\n${rows.map((line,index)=>`${index}: ${line}`).join('\n')}`;
  const thinking=thinkingConfig(model);
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  // 헤더뿐 아니라 응답 본문 읽기까지 5초로 제한한다. 취소가 늦어져도 규칙 파서로 돌아간다.
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort();
      reject(new Error('receipt structuring timed out'));
    },STRUCTURING_BUDGET_MS);
  });
  const request=async()=>{
    // 품목 정리는 보조 단계이므로 실패 시 추가 API 호출 없이 기존 규칙을 사용한다.
    const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:controller.signal,
      body:JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{temperature:0,responseMimeType:'application/json',responseJsonSchema:SCHEMA,...(thinking?{thinkingConfig:thinking}:{})}}),
    });
    controller.signal.throwIfAborted();
    if(!response.ok)throw new Error(`Gemini ${response.status}`);
    const data=await response.json();
    controller.signal.throwIfAborted();
    const output=data.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text??'').join('');
    if(!output)throw new Error('empty receipt result');
    return parseReceiptItems(JSON.parse(output),rows);
  };
  try{return await Promise.race([request(),deadline]);}
  finally{clearTimeout(timer);}
}

/** OCR 응답 본문. Gemini 설정이 없거나 실패하면 items 없이 words만 보내고, 브라우저가 규칙 파서로 처리한다. */
export async function receiptResponse(words:OcrWord[],key?:string,model?:string,fetcher:typeof fetch=fetch){
  if(!key||!model||!words.length)return {words};
  try{return {words,items:await structureReceipt(key,model,groupRows(words),fetcher)}}
  catch{console.error('[receipt] Gemini structuring failed; falling back to rules');return {words}}
}
