import { useEffect, useRef, useState } from 'react';
import { SubHeader } from '../../components/SubHeader';
import { asset } from '../../lib/assets';
import type { Navigate, ScreenId } from '../../prototype/flow';
import { fileToJpegBase64, MAX_SIDE, useCamera } from './useCamera';

const statusMessages = {
  starting: '카메라를 켜는 중이에요',
  denied: '카메라 권한이 필요해요.\n브라우저 설정에서 카메라를 허용하거나 앨범에서 사진을 선택해 주세요.',
  unavailable: '카메라를 사용할 수 없어요.\n앨범에서 사진을 선택해 주세요.',
} as const;

// 촬영 가이드별 카메라 화면 문구. 어느 가이드에서 들어왔는지(backDestination)로 고른다.
const copies = {
  'guide-receipt': { title: '영수증 촬영', guide: '영수증 전체가 보이도록 맞춰 주세요', tip: '글씨가 선명하고 빛이 반사되지 않게 촬영해 주세요', busy: '영수증을 읽는 중이에요' },
  'guide-fridge': { title: '냉장고 칸 촬영', guide: '냉장고 칸 전체가 보이도록 맞춰 주세요', tip: '문을 활짝 열고 밝은 곳에서 촬영해 주세요', busy: '식재료를 인식하는 중이에요' },
  'guide-product': { title: '상품 촬영', guide: '상품 전체가 보이도록 맞춰 주세요', tip: '상품명과 포장지 글자가 잘 보이게 촬영해 주세요', busy: '상품을 인식하는 중이에요' },
} as const;

type Props = { navigate: Navigate; onCapture: (image: string) => Promise<void>; backDestination?: ScreenId };

/** 영수증 OCR - 카메라 촬영 (Figma 5579:702) */
export function ReceiptCameraPage({ navigate, onCapture, backDestination = 'guide-receipt' }: Props) {
  const camera = useCamera();
  const albumInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const toggleFlash = async () => {
    if (await camera.toggleTorch()) return;
    // iOS 사파리·PC 브라우저는 웹에서 플래시를 켤 수 없다.
    setNotice('이 기기에서는 플래시를 켤 수 없어요.\n밝은 곳에서 촬영해 주세요.');
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2500);
  };
  const submit = async (getImage: () => Promise<string | null> | string | null) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const image = await getImage();
      if (!image) throw new Error('사진을 찍지 못했어요. 다시 시도해 주세요.');
      await onCapture(image);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '다시 시도해 주세요.');
    } finally { setBusy(false); }
  };
  const copy = copies[backDestination as keyof typeof copies] ?? copies['guide-receipt'];
  const maxSide = backDestination === 'guide-product' ? MAX_SIDE.product : backDestination === 'guide-fridge' ? MAX_SIDE.fridge : MAX_SIDE.receipt;
  const message = busy ? copy.busy : error || notice || (camera.status === 'ready' ? '' : statusMessages[camera.status]);
  return (
    <main className="receipt-camera" data-figma-node="5579:702">
      <SubHeader title={copy.title} onBack={() => navigate(backDestination)} />
      <section className="camera-view" aria-label="카메라 미리보기">
        <div className="camera-guide-bar">
          <p>{copy.guide}</p>
          <button type="button" className="camera-flash" aria-label={camera.torch.on ? '플래시 켜짐' : '플래시 꺼짐'} aria-pressed={camera.torch.on} disabled={busy || camera.status !== 'ready'} onClick={() => void toggleFlash()}>
            <img src={asset(camera.torch.on ? 'flash-on.svg' : 'flash-off.svg')} alt="" width={24} height={24} />
          </button>
        </div>
        <div className="camera-preview" aria-busy={busy}>
          <video ref={camera.videoRef} className="camera-video" playsInline muted hidden={camera.status !== 'ready'} />
          <img className="receipt-guide-frame" src={asset('receipt-guide-frame.svg')} alt="" width={266} height={402} />
          {message && <p className="camera-message" role={error ? 'alert' : 'status'}>{message}</p>}
        </div>
        <div className="camera-controls">
          <p className="camera-tip">{copy.tip}</p>
          <div className="camera-actions">
            <button type="button" className="camera-album" disabled={busy} onClick={() => albumInput.current?.click()}>
              <img src={asset('album.svg')} alt="" width={28} height={28} />
              <span>앨범</span>
            </button>
            <input ref={albumInput} type="file" accept="image/*" hidden onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void submit(() => fileToJpegBase64(file, maxSide));
            }} />
            <button type="button" className="camera-shutter" aria-label={copy.title} disabled={busy || camera.status !== 'ready'} onClick={() => void submit(() => camera.capture(maxSide))}>
              <img src={asset('shutter.svg')} alt="" width={80} height={80} />
            </button>
            <span className="camera-actions-spacer" />
          </div>
          {error&&<button type="button" disabled={busy} onClick={()=>navigate('manual-entry')}>직접 입력하기</button>}
          <p className="camera-label">{copy.title}</p>
          <span className="home-indicator" />
        </div>
      </section>
    </main>
  );
}
