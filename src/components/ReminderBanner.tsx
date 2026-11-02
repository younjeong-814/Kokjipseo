import type { ReactNode } from 'react';

type Props = { title?: ReactNode; description?: ReactNode };

export function ReminderBanner({ title = '식재료를 간편하게 등록해 보세요', description = <>원하는 방법으로 식재료를 등록하고,<br />냉장고 속 재료를 편리하게 관리해 보세요</> }: Props) {
  return <div className="welcome-banner"><h2>{title}</h2><p>{description}</p></div>;
}
