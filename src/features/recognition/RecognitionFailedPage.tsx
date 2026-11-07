import { ActionButton } from '../../components/ActionButton';
import { SubHeader } from '../../components/SubHeader';
import { asset } from '../../lib/assets';
import type { RecognitionFailureKind, RecognitionSource } from './RecognitionError';

type Props = { kind: RecognitionFailureKind; source: RecognitionSource; message: string; onBack: () => void; onRetake: () => void; onManual: () => void };

const subjects: Record<RecognitionSource, { found: string; read: string }> = {
  receipt: { found: '영수증에서', read: '영수증을 읽지 못했어요' },
  fridge: { found: '사진에서', read: '사진을 인식하지 못했어요' },
  product: { found: '상품 사진에서', read: '상품을 인식하지 못했어요' },
};

/** 인식 실패 화면. 디자인 시안 전이라 레시피 결과 없음 화면(Figma 3061:13500) 구성을 따른다. */
export function RecognitionFailedPage({ kind, source, message, onBack, onRetake, onManual }: Props) {
  const title = kind === 'empty' ? `${subjects[source].found}\n식재료를 찾지 못했어요`
    : kind === 'limit' ? `오늘 ${source === 'receipt' ? '영수증' : '사진'} 인식 횟수를\n모두 사용했어요`
    : subjects[source].read;
  // 한도에 걸리면 다시 찍어도 실패하므로 직접 입력만 안내한다.
  const description = kind === 'limit' ? '내일 다시 이용하거나\n지금은 직접 입력으로 등록해 주세요' : message;
  return <main className="recognition-failed" data-kind={kind}>
    <SubHeader title={source === 'receipt' ? '영수증 촬영' : source === 'fridge' ? '냉장고 칸 촬영' : '상품 촬영'} onBack={onBack} />
    <section className="recognition-failed-state" role="alert">
      <img className="recognition-failed-image" src={asset('empty-fridge.png')} alt="" />
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
    <div className="recognition-failed-actions">
      {kind !== 'limit' && <ActionButton className="action-button-large recognition-retake" onClick={onRetake}>재촬영</ActionButton>}
      <ActionButton className="action-button-large" onClick={onManual}>직접 입력하기</ActionButton>
    </div>
  </main>;
}
