import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { photoRecognitionMiddleware } from './server/photoRecognition';
import { receiptOcrMiddleware } from './server/receiptOcr';
import { recipesMiddleware } from './server/recipes';
import { geminiRecognizeMiddleware } from './server/geminiRecognize';
import { manualReminderTestMiddleware } from './server/manualReminderTest';

function recipeApi(foodSafetyKey: string | undefined, mafraKey: string | undefined): Plugin {
  const middleware = recipesMiddleware(foodSafetyKey, mafraKey);
  return {
    name: 'hybrid-recipes',
    configureServer: server => { server.middlewares.use('/api/recipes', middleware); },
    configurePreviewServer: server => { server.middlewares.use('/api/recipes', middleware); },
  };
}

// VITE_ 접두사가 없는 키는 클라이언트 번들에 포함되지 않는다.
function visionOcr(apiKey: string | undefined, geminiKey: string | undefined, geminiModel: string | undefined): Plugin {
  const middleware = receiptOcrMiddleware(apiKey, geminiKey, geminiModel);
  return {
    name: 'vision-ocr',
    configureServer: server => { server.middlewares.use('/api/ocr', middleware); },
    configurePreviewServer: server => { server.middlewares.use('/api/ocr', middleware); },
  };
}

function geminiRecognize(apiKey: string | undefined, model: string | undefined): Plugin {
  const middleware = geminiRecognizeMiddleware(apiKey, model);
  return {
    name: 'gemini-recognize',
    configureServer: server => { server.middlewares.use('/api/recognize', middleware); },
    configurePreviewServer: server => { server.middlewares.use('/api/recognize', middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  for (const [name,value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue;
    const allowed=['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_RECIPE_ENDPOINT','VITE_OCR_ENDPOINT','VITE_RECOGNIZE_ENDPOINT'];
    if(!allowed.includes(name)) throw new Error(`공개 환경변수를 확인해 주세요: ${name}. 비밀 키는 Supabase Secrets에만 설정하세요.`);
    if(name==='VITE_SUPABASE_PUBLISHABLE_KEY'&&value&&!value.startsWith('sb_publishable_')) throw new Error('공개용 Supabase publishable key만 사용할 수 있어요.');
    if(/sb_secret_|AIza|[?&](?:key|api_key|token)=/i.test(value)) throw new Error(`비밀 인증정보가 공개 변수에 포함될 수 있어요: ${name}`);
  }
  if(Boolean(env.VITE_SUPABASE_URL)!==Boolean(env.VITE_SUPABASE_PUBLISHABLE_KEY))throw new Error('Supabase URL과 publishable key를 함께 설정해 주세요.');
  return {
    plugins: [react(), {name:'local-reminder-test',configureServer(server){server.middlewares.use('/api/email-reminder-test',manualReminderTestMiddleware(env));}}, visionOcr(env.GOOGLE_VISION_API_KEY, env.GEMINI_API_KEY, env.GEMINI_MODEL), geminiRecognize(env.GEMINI_API_KEY, env.GEMINI_MODEL), recipeApi(env.FOOD_SAFETY_API_KEY, env.FOOD_API_KEY)],
    base: './',
    build:{rollupOptions:{output:{manualChunks:{supabase:['@supabase/supabase-js']}}}},
  };
});
