import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { CloudRoot } from './features/cloud/CloudRoot';
import { useState } from 'react';
import { SplashScreen } from './features/splash/SplashScreen';
import { OnboardingContext } from './features/splash/OnboardingContext';
import { captureEntryContext } from './features/notifications/entryContext';
import './styles/splash.css';
import './styles/first-use-guide.css';
import './styles/cloud.css';
import './styles/email-reminder.css';
import './styles/ut-consent.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/screens.css';
import './styles/recognition.css';
import './styles/recognition-overlays.css';
import './styles/manual-entry.css';
import './styles/recipe.css';
import './styles/fridge-search.css';
import './styles/ingredients.css';
import './styles/ingredient-detail.css';
// Keep mail entry details before splash/auth/route effects replace the hash.
captureEntryContext();
window.addEventListener('hashchange', () => { captureEntryContext(); });
function EntryPoint() {
  const [entered, setEntered] = useState(false);
  const [firstUseGuidePending, setFirstUseGuidePending] = useState(false);
  const [welcomeRequested, setWelcomeRequested] = useState(false);
  if (!entered) return <SplashScreen onEnter={() => {
    setEntered(true);
    try { setFirstUseGuidePending(localStorage.getItem('kokjipseo:first-use-guide-seen') !== '1'); }
    catch { setFirstUseGuidePending(true); }
  }} />;
  return <OnboardingContext.Provider value={{guidePending:firstUseGuidePending,welcomeRequested,requestWelcome:()=>setWelcomeRequested(true)}}><CloudRoot><App firstUseGuidePending={firstUseGuidePending} onFirstUseGuideComplete={() => {
      try { localStorage.setItem('kokjipseo:first-use-guide-seen', '1'); } catch { /* 세션 내에서는 계속 닫힌 상태로 둔다 */ }
      setFirstUseGuidePending(false);
    }} /></CloudRoot></OnboardingContext.Provider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><EntryPoint /></React.StrictMode>);

import './styles/recipe-results.css';
import './styles/recipe-detail.css';
import './styles/weekly-report.css';

import './styles/mypage-dashboard.css';
import './styles/responsive.css';
import './styles/fridge-notifications.css';
import './styles/manual-reminder-test.css';
