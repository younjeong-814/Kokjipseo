import { cloudUrl, supabase } from './client';

// 안드로이드 인앱 브라우저는 blob 다운로드를 처리하지 못한다. 아이폰 인앱 브라우저는 정상이라 제외한다.
export function isAndroidInApp(ua=navigator.userAgent) {
  return /Android/i.test(ua) && /KAKAOTALK|NAVER\(inapp|Instagram/i.test(ua);
}

export function externalBrowserUrl(url:string, ua=navigator.userAgent) {
  if (/KAKAOTALK/i.test(ua)) return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  return `intent://${url.replace(/^https?:\/\//,'')}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

// 백업 내용을 서버에 5분간 맡기고, 외부 브라우저에서 일회용 링크로 바로 내려받게 한다.
export async function downloadInExternalBrowser(filename:string, content:string) {
  if (!supabase || !cloudUrl) throw new Error('클라우드 연결이 설정되지 않아 파일을 내보낼 수 없어요.');
  const { data, error } = await supabase.rpc('create_export_download', { p_filename: filename, p_content: content });
  if (error || typeof data !== 'string') throw new Error(error?.message.includes('request_limit') ? '잠시 후 다시 내보내 주세요.' : '백업 파일을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
  window.location.href = externalBrowserUrl(`${cloudUrl}/functions/v1/export-download?t=${data}`);
}
