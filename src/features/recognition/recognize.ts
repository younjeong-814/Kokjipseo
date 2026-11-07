import { requestExternal } from '../cloud/externalRequests';
import type { PhotoRecognitionItem } from './photoApi';
import { isExcludedItem } from '../ingredients/classify';
import { RecognitionError, failureKind, isLoginError } from './RecognitionError';

export type RecognizeMode = 'fridge' | 'product';

// 개발·미리보기 서버의 /api/recognize(vite.config.ts)이 기본값이다. 배포 시 서버리스 함수 주소로 바꾼다.
const ENDPOINT = import.meta.env.VITE_RECOGNIZE_ENDPOINT || '/api/recognize';

/** 사진에 보이는 식재료 이름을 돌려준다. 중복과 비식품은 뺀다. */
export async function recognizeIngredients(image: string, mode: RecognizeMode): Promise<(string | PhotoRecognitionItem)[]> {
  let response: Response;
  try {
    response = await requestExternal('recognize', ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, mode }) });
  } catch (error) {
    if (isLoginError(error)) throw error;
    throw new RecognitionError('failed', mode, '네트워크에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }
  const data = await response.json().catch(() => ({})) as { items?: (string | PhotoRecognitionItem)[]; error?: string; mode?: string };
  if(data.mode==='mock') throw new RecognitionError('failed', mode, '사진 인식 서버 설정 후 다시 촬영해 주세요.');
  if (response.status === 401) throw new Error(data.error ?? '로그인 후 다시 시도해 주세요.');
  if (!response.ok || !Array.isArray(data.items)) throw new RecognitionError(failureKind(response.status), mode, data.error ?? '식재료를 인식하지 못했어요. 다시 촬영해 주세요.');
  const seen = new Set<string>();
  const names = data.items.filter(item => {
    const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
    if (!name || isExcludedItem(name) || seen.has(name)) return false;
    seen.add(name); return true;
  }).map(item => typeof item === 'string' ? item.trim() : item);
  if (!names.length) throw new RecognitionError('empty', mode, mode === 'fridge' ? '냉장고 칸이 밝고 선명하게 보이도록 다시 촬영해 주세요.' : '상품 전체가 보이도록 다시 촬영해 주세요.');
  return names;
}
