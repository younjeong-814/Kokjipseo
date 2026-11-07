import {annotateImage} from '../_shared/generated/vision.ts';
import {securedHandler,imageBody,HttpError} from '../_shared/http.ts';
import {receiptResponse} from '../_shared/receipt.ts';
const env=Deno.env.toObject();
Deno.serve(securedHandler(env,'ocr','POST',async(request)=>{
  const {image}=await imageBody(request);
  if(env.EXTERNAL_API_MODE==='mock')return {mode:'mock',words:[]};
  if(!env.GOOGLE_VISION_API_KEY)throw new HttpError(503,'OCR 서버의 GOOGLE_VISION_API_KEY 설정이 필요해요.');
  // GEMINI_API_KEY·GEMINI_MODEL이 있으면 품목 정리(items)를 함께 보낸다. 없거나 실패하면 words만 보낸다.
  return receiptResponse(await annotateImage(env.GOOGLE_VISION_API_KEY,image),env.GEMINI_API_KEY,env.GEMINI_MODEL);
}));
