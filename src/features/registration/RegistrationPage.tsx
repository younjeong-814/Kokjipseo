import { ReminderBanner } from '../../components/ReminderBanner';
import { useState } from 'react';
import { asset } from '../../lib/assets';
import type { Navigate } from '../../prototype/flow';

export const methods = [
  { title: '냉장고 칸 촬영', image: 'method-fridge.png', description: <>냉장고 안을 촬영해 여러 <br />식재료를 등록해요</> },
  { title: '상품 직접 촬영', image: 'method-camera.png', description: <>상품을 촬영해 식재료 정보<br />를 간편하게 등록해요</> },
  { title: '영수증 촬영', image: 'method-receipt.png', description: <>영수증을 촬영해 식재료를 <br />간편하게 등록해요</> },
  { title: '직접입력', image: 'method-edit.png', description: <>필요한 정보를 직접 입력해 <br />식재료를 등록해요</> },
];

export function RegistrationPage({ navigate }: { navigate: Navigate }) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  return (
    <main className="registration-page" data-figma-node="5558:19197">
      <section className="reminder-section"><ReminderBanner /></section>
      <section className="registration-methods">
        <h2>식재료 기록 방식</h2>
        <div className="method-grid" role="group" aria-label="식재료 기록 방식 선택">{methods.map((method) => {
          const content = <><img src={asset(method.image)} alt="" /><h3>{method.title}</h3><p>{method.description}</p></>;
          return <button type="button" key={method.title} className={`method-card${selectedMethod === method.title ? ' selected' : ''}`} aria-pressed={selectedMethod === method.title} onClick={() => setSelectedMethod(method.title)}>{content}</button>;
        })}</div>
      </section>
      <div className="large-button-section"><button type="button" className="action-button action-button-large" disabled={selectedMethod === null} onClick={() => { if (selectedMethod !== null) navigate((['guide-fridge', 'guide-product', 'guide-receipt', 'manual-entry'] as const)[methods.findIndex(method => method.title === selectedMethod)]); }}>{selectedMethod === null ? '등록 방식을 선택해주세요' : `${selectedMethod}하기`}</button></div>
    </main>
  );
}
