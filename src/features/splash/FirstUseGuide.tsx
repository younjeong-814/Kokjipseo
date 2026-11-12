import { asset } from '../../lib/assets';

export function FirstUseGuide({ onClose }: { onClose: () => void }) {
  return <div className="first-use-guide" role="dialog" aria-modal="true" aria-labelledby="first-use-guide-title">
    <div className="first-use-guide-frame">
      <GuideBackdrop />
      <img className="first-use-guide-dim" src={asset('first-use-guide-dim.svg')} alt="" />
      <button type="button" className="first-use-guide-close" aria-label="가이드 닫기" onClick={onClose}>
        <img src={asset('first-use-guide-close.svg')} alt="" />
      </button>
      <header className="first-use-guide-header">
        <p>콕집서 첫 이용 가이드</p>
        <h1 id="first-use-guide-title">식재료를 등록하면 이런 기능을 이용할 수 있어요!</h1>
      </header>
      <section className="first-use-guide-expiry" aria-label="소비 권장일 안내">
        <h2>소비 권장일을 한눈에 확인해요</h2>
        <p>등록한 식재료의 소비 권장일을 쉽게 확인할 수 있어요.</p>
      </section>
      <img className="first-use-guide-expiry-curve" src={asset('first-use-guide-curve-expiry.svg')} alt="" />
      <section className="first-use-guide-recipes" aria-label="레시피 안내">
        <h2>임박한 식재료로 레시피를 찾아보세요</h2>
        <p>소비 권장일이 가까운 식재료를 활용한 레시피를 확인할 수 있어요.</p>
      </section>
      <img className="first-use-guide-recipe-curve" src={asset('first-use-guide-curve-recipes.svg')} alt="" />
    </div>
  </div>;
}

function GuideBackdrop() {
  return <div className="first-use-guide-backdrop" aria-hidden="true">
    <header className="first-use-guide-mock-header">오늘의 냉장고</header>
    <section className="first-use-guide-mock-banner">
      <h2>오늘 꼭 챙겨야 할 재료가 있어요</h2>
      <p>소비기한이 지난 재료는 상태를 확인하고,<br/>임박한 재료로 메뉴를 추천받아 보세요.</p>
    </section>
    <section className="first-use-guide-mock-summary">
      <h2>내 냉장고 요약</h2>
      <div className="first-use-guide-mock-summary-card">
        {(['냉장', '냉동', '실온'] as const).map((name, index) => <div className="first-use-guide-mock-summary-item" key={name}>
          <span className={`storage-icon storage-icon-${index}`}><img src={asset('storage.png')} alt="" /></span>
          <span>{name}</span><strong>{[18, 12, 2][index]}개</strong>
        </div>)}
      </div>
    </section>
    <section className="first-use-guide-mock-list">
      <h2>오늘의 소비 권장</h2>
      <GuideIngredient image="thumb-sauce.png" name="샘표 조선국간장" info="실온 · 1병" badge="기한경과" />
      <GuideIngredient image="thumb-bean.png" name="두부" info="냉장 · 1모" badge="D-DAY" />
      <GuideIngredient image="thumb-meat.png" name="저온숙성 무항생제 한돈삼겹살 1kg" info="냉장 · 1kg" badge="D-3" />
      <GuideIngredient image="thumb-vegetable.png" name="대파" info="냉장 · 2대" badge="D-1" />
    </section>
    <nav className="first-use-guide-mock-nav">
      <span className="selected"><img src={asset('home.svg')} alt=""/>홈</span>
      <span><img src={asset('nav-2.svg')} alt=""/>냉장고</span>
      <span><img src={asset('nav-5.svg')} alt=""/>등록</span>
      <span><img src={asset('recipe-active.svg')} alt=""/>레시피</span>
      <span><img src={asset('nav-1.svg')} alt=""/>마이</span>
    </nav>
  </div>;
}

function GuideIngredient({ image, name, info, badge }: { image: string; name: string; info: string; badge: string }) {
  return <div className="first-use-guide-mock-row">
    <img className="first-use-guide-mock-thumb" src={asset(image)} alt="" />
    <span className="first-use-guide-mock-copy"><strong>{name}</strong><span>{info}</span></span>
    <span className={`first-use-guide-mock-badge${badge === '기한경과' ? ' expired' : ''}`}>{badge}</span>
  </div>;
}
