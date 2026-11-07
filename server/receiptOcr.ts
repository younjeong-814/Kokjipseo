// 개발·미리보기 서버의 /api/ocr. 배포 환경의 ocr Edge 함수와 같은 순서로 Vision OCR 후 Gemini로 품목을 정리한다.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { annotateImage, readBody } from './visionOcr';
import { receiptResponse } from '../supabase/functions/_shared/receipt';
import { DEFAULT_GEMINI_MODEL } from './geminiRecognize';

export function receiptOcrMiddleware(visionKey: string | undefined, geminiKey: string | undefined, geminiModel: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: object) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'POST만 지원해요.' });
    if (!visionKey) return send(500, { error: 'GOOGLE_VISION_API_KEY가 설정되지 않았어요.' });
    let image: unknown;
    try { image = (JSON.parse(await readBody(req)) as { image?: unknown }).image; }
    catch { return send(400, { error: '이미지를 읽을 수 없어요.' }); }
    if (typeof image !== 'string' || !image) return send(400, { error: '이미지가 없어요.' });
    let words;
    try { words = await annotateImage(visionKey, image); }
    catch { console.error('[vision-ocr] upstream request failed'); return send(502, { error: '문자 인식 서버에 연결하지 못했어요.' }); }
    // 사진 인식(/api/recognize)과 같이 GEMINI_MODEL이 없으면 기본 모델을 쓴다.
    send(200, await receiptResponse(words, geminiKey, geminiModel || DEFAULT_GEMINI_MODEL));
  };
}
