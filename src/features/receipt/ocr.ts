import { requestExternal } from '../cloud/externalRequests';
import { groupRows, parseReceipt, type OcrWord, type ReceiptItem, type ReceiptResult } from './parseReceipt';
import { isExcludedItem } from '../ingredients/classify';
import { RecognitionError, failureKind, isLoginError } from '../recognition/RecognitionError';

// 개발·미리보기 서버의 /api/ocr(vite.config.ts)이 기본값이다. 배포 시 서버리스 함수 주소로 바꾼다.
const ENDPOINT = import.meta.env.VITE_OCR_ENDPOINT || '/api/ocr';

export async function recognizeReceipt(image: string): Promise<ReceiptResult> {
  let response: Response;
  try {
    response = await requestExternal('ocr',ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  } catch (error) {
    if (isLoginError(error)) throw error;
    throw new RecognitionError('failed', 'receipt', '네트워크에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }
  const data = await response.json().catch(() => ({})) as { words?: OcrWord[]; items?: ReceiptItem[]; error?: string; mode?:string };
  if(data.mode==='mock')throw new RecognitionError('failed', 'receipt', 'OCR은 모의 연결 상태예요. 실제 서버 설정 후 다시 촬영해 주세요.');
  if (response.status === 401) throw new Error(data.error ?? '로그인 후 다시 시도해 주세요.');
  if (!response.ok || !Array.isArray(data.words)) throw new RecognitionError(failureKind(response.status), 'receipt', data.error ?? '영수증을 읽지 못했어요. 다시 촬영해 주세요.');
  // 날짜·시간은 규칙 파서로 읽는다. 품목은 서버가 Gemini로 정리한 결과(items)를 쓰고, 없거나 비면 규칙 파서 결과를 쓴다.
  const result = parseReceipt(groupRows(data.words));
  if (Array.isArray(data.items) && data.items.length) result.items = data.items;
  // 비식품·주류는 식재료로 등록하지 않는다(classify.ts).
  result.items = result.items.filter(item => !isExcludedItem(item.name));
  if (!result.items.length) throw new RecognitionError('empty', 'receipt', '영수증 전체가 선명하게 보이도록 다시 촬영해 주세요.');
  return result;
}
