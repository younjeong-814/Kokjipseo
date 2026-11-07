// Gemini 식재료 인식 프록시. 냉장고 칸·상품 사진에 보이는 식재료 이름만 돌려준다.
// API 키는 서버에만 두고, 배포 시에는 같은 함수를 서버리스 함수에서 호출하면 된다.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from './visionOcr';

export type RecognizeMode = 'fridge' | 'product';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// 모델 ID는 GEMINI_MODEL로 바꿀 수 있다. 사용 가능한 ID는 models 목록 API로 확인한다.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

const PROMPTS: Record<RecognizeMode, string> = {
  fridge: '냉장고 칸을 찍은 사진이다. 보이는 식재료와 음식을 모두 찾아라.',
  product: '식재료나 음식 하나를 찍은 사진이다. 사진의 중심에 있는 식재료나 음식을 찾아라.',
};
const RULES = [
  '포장지 글자, 상품명, 브랜드는 읽지 말고 눈에 보이는 모양으로만 판단한다.',
  "이름은 '대파', '두부', '우유'처럼 짧은 한국어 일반 이름으로 쓴다.",
  '같은 종류는 한 번만 쓴다. 식재료나 음식이 아닌 물건은 빼고, 확실하지 않으면 쓰지 않는다.',
  '찾은 것이 없으면 빈 배열을 돌려준다.',
].join('\n');

// 과부하(503)·요청 한도(429)는 잠시 뒤 한 번 더 시도한다.
const RETRY_STATUS = [429, 503];
const RETRY_DELAY = 1500;

// 식재료 목록 추출에는 긴 추론이 필요 없어 생각(thinking)을 최소로 줄인다. Edge의 photo.ts와 같은 규칙이다.
export function thinkingConfig(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-([3-9]|\d{2})/.test(model)) return { thinkingLevel: model.includes('flash') ? 'minimal' : 'low' };
  return undefined;
}

export async function recognizeIngredients(apiKey: string, image: string, mode: RecognizeMode, model = DEFAULT_GEMINI_MODEL): Promise<string[]> {
  const thinking = thinkingConfig(model);
  const request = (withThinking = true) => fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: `${PROMPTS[mode]}\n${RULES}` }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['items'] },
        ...(withThinking && thinking ? { thinkingConfig: thinking } : {}),
      },
    }),
  });
  const started = Date.now();
  let response = await request();
  // 모델이 생각 설정을 지원하지 않으면(400) 설정 없이 한 번 더 요청한다.
  if (response.status === 400 && thinking) response = await request(false);
  if (RETRY_STATUS.includes(response.status)) {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    response = await request();
  }
  const data = await response.json() as GeminiResponse;
  console.log(`[gemini-recognize] ${model} ${response.status} ${Date.now() - started}ms`);
  if (!response.ok || data.error) throw new Error(data.error?.message ?? `Gemini API ${response.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '';
  const items = (JSON.parse(text || '{}') as { items?: unknown }).items;
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : [];
}

export function geminiRecognizeMiddleware(apiKey: string | undefined, model: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: object) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'POST만 지원해요.' });
    if (!apiKey) return send(500, { error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    let body: { image?: unknown; mode?: unknown };
    try { body = JSON.parse(await readBody(req)) as typeof body; }
    catch { return send(400, { error: '이미지를 읽을 수 없어요.' }); }
    if (typeof body.image !== 'string' || !body.image) return send(400, { error: '이미지가 없어요.' });
    const mode: RecognizeMode = body.mode === 'product' ? 'product' : 'fridge';
    try { send(200, { items: await recognizeIngredients(apiKey, body.image, mode, model || undefined) }); }
    catch (error) {
      console.error('[gemini-recognize]', error);
      send(502, { error: '식재료 인식 서버에 연결하지 못했어요.' });
    }
  };
}
