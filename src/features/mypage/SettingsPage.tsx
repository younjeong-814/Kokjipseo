import { useEffect, useState } from 'react';
import { SubHeader } from '../../components/SubHeader';
import { CloudAccountSlot } from '../cloud/AccountContext';
import { EmailReminderModal } from './EmailReminderModal';

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const [emailModalMode, setEmailModalMode] = useState<'apply' | 'change' | null>(null);
  useEffect(() => {
    const open = (event: Event) => setEmailModalMode(event instanceof CustomEvent && event.detail === 'change' ? 'change' : 'apply');
    window.addEventListener('kokjipseo:open-email-reminder', open);
    return () => window.removeEventListener('kokjipseo:open-email-reminder', open);
  }, []);
  return <>
    <SubHeader title="설정" onBack={onBack} />
    <main className="settings-page"><CloudAccountSlot /></main>
    {emailModalMode && <EmailReminderModal mode={emailModalMode} onClose={() => setEmailModalMode(null)} />}
  </>;
}
