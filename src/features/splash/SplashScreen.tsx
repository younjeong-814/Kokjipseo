import { asset } from '../../lib/assets';

type SplashScreenProps = { onEnter: () => void };

export function SplashScreen({ onEnter }: SplashScreenProps) {
  return <button type="button" className="splash-screen" onClick={onEnter} aria-label="콕집서 시작하기">
    <span className="splash-brand">
      <img className="splash-logo" src={asset('splash-logo.png')} alt="콕집서" />
      <span className="splash-tagline"><span>잊기 전에 <strong>콕</strong>,</span><span>내 냉장고를 챙겨요.</span></span>
    </span>
    <span className="splash-footer">내 냉장고를 위한 작은 습관</span>
  </button>;
}
