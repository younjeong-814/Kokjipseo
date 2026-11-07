import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable';

// 영수증은 글씨를 읽어야 해서 1600px, 냉장고 칸·상품은 모양만 보면 돼서 더 작게 보낸다.
// 작을수록 업로드와 Gemini 처리 시간이 줄어든다.
export const MAX_SIDE = { receipt: 1600, fridge: 1280, product: 1024 } as const;
const DEFAULT_MAX_SIDE = MAX_SIDE.receipt;

/** 후면 카메라 미리보기와 촬영. 화면을 벗어나면 카메라를 끈다. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('unavailable'); return; }
    let stream: MediaStream | undefined;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async media => {
        stream = media;
        if (cancelled) { media.getTracks().forEach(track => track.stop()); return; }
        const [track] = media.getVideoTracks();
        const video = videoRef.current;
        if (video) { video.srcObject = media; await video.play().catch(() => undefined); }
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'unavailable');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  /** 현재 프레임을 OCR에 보낼 JPEG(base64)로 만든다. */
  const capture = useCallback((maxSide: number = DEFAULT_MAX_SIDE) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    return toJpegBase64(video, video.videoWidth, video.videoHeight, maxSide);
  }, []);

  return { videoRef, status, capture };
}

export async function fileToJpegBase64(file: File, maxSide: number = DEFAULT_MAX_SIDE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try { return toJpegBase64(bitmap, bitmap.width, bitmap.height, maxSide); }
  finally { bitmap.close(); }
}

// 긴 변을 maxSide 이하로 줄여 전송량을 줄인다. 영수증은 1600px이면 글씨가 충분히 읽힌다.
function toJpegBase64(source: CanvasImageSource, width: number, height: number, maxSide: number): string {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지를 처리할 수 없어요.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}
