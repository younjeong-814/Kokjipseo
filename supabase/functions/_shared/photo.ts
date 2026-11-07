import {HttpError} from './http.ts';
const categories=['육류','과일','채소','두부·콩류','유제품','수산물','조미료·소스','가공식품','기타 식재료','밀키트','반찬','국·찌개','배달음식','기타 음식'];
export type PhotoItem={name:string;category:string;quantity:number;uncertain:boolean};
export function parsePhotoResult(value:unknown):PhotoItem[]{
  const data=value as {items?:unknown[]};
  if(!data||!Array.isArray(data.items)||data.items.length>30)throw new HttpError(502,'사진 인식 결과 형식을 확인하지 못했어요.');
  return data.items.map(raw=>{const item=raw as PhotoItem;if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>60||!categories.includes(item.category)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100||typeof item.uncertain!=='boolean')throw new HttpError(502,'사진 인식 결과를 확인하지 못했어요. 다시 촬영해 주세요.');return {...item,name:item.name.trim()}});
}
// 식재료 목록 추출에는 긴 추론이 필요 없어 생각(thinking)을 최소로 줄여 응답을 앞당긴다.
// 2.5 Flash는 thinkingBudget 0으로 끄고, 3세대 이후는 thinkingLevel로 낮춘다. 그 밖의 모델은 기본값을 쓴다.
export function thinkingConfig(model:string):Record<string,unknown>|undefined{
  if(/^gemini-2\.5-flash/.test(model))return {thinkingBudget:0};
  if(/^gemini-([3-9]|\d{2})/.test(model))return {thinkingLevel:model.includes('flash')?'minimal':'low'};
  return undefined;
}
export async function recognizePhoto(key:string,model:string,image:string,mode:string,fetcher:typeof fetch=fetch):Promise<PhotoItem[]>{
  if(!/^gemini-[a-zA-Z0-9.-]+$/.test(model))throw new HttpError(503,'서버의 GEMINI_MODEL 설정을 확인해 주세요.');
  const thinking=thinkingConfig(model);
  const request=(withThinking:boolean)=>fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(45000),
    body:JSON.stringify({contents:[{parts:[{text:`${mode==='fridge'?'냉장고 칸':'상품'} 사진에서 실제로 보이는 먹을 수 있는 식재료와 음식을 한국어로 나열하세요. 포장·물건·배경은 제외하세요. 보이지 않는 식재료나 신선도·소비기한은 추측하지 마세요. 같은 식재료는 합치고 개수가 불명확하면 quantity는 1, uncertain은 true로 하세요. 빈 사진이나 식품이 없으면 items는 빈 배열입니다. category는 지정된 분류만 사용하세요.`},{inlineData:{mimeType:'image/jpeg',data:image}}]}],generationConfig:{temperature:0,responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:{items:{type:'array',maxItems:30,items:{type:'object',properties:{name:{type:'string'},category:{type:'string',enum:categories},quantity:{type:'integer'},uncertain:{type:'boolean'}},required:['name','category','quantity','uncertain'],additionalProperties:false}}},required:['items'],additionalProperties:false},...(withThinking&&thinking?{thinkingConfig:thinking}:{})}}),
  });
  let response=await request(true);
  // 모델이 생각 설정을 지원하지 않으면(400) 설정 없이 한 번 더 요청한다.
  if(response.status===400&&thinking)response=await request(false);
  if(!response.ok)throw new HttpError(response.status===429?429:502,response.status===429?'사진 인식 이용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.':'사진 인식 서비스에 연결하지 못했어요.');
  const data=await response.json();
  const text=data.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text??'').join('');
  if(!text)throw new HttpError(502,'사진에서 결과를 읽지 못했어요. 다시 촬영해 주세요.');
  try{return parsePhotoResult(JSON.parse(text))}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(502,'사진 인식 응답을 읽지 못했어요.')}
}
