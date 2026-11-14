import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function OverlayDialog({ label, children, onClose, onOpen, sheet = false, dismissOutside = true, className = '' }: {
  label: string; children: ReactNode; onClose: () => void; onOpen?:()=>void; sheet?: boolean; dismissOutside?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opened=useRef(onOpen);opened.current=onOpen;
  // 자식(시간 휠 등)의 useEffect가 열린 dialog 안에서 스크롤 위치를 잡을 수 있도록 레이아웃 단계에서 연다.
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    opened.current?.();
    dialog.querySelector<HTMLInputElement>('[autofocus]')?.focus();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} aria-label={label} className={`recognition-overlay ${sheet ? 'bottom-sheet' : ''} ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (!dismissOutside || event.target !== ref.current) return;
    const box = ref.current!.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
  }}>{children}</dialog>;
}
