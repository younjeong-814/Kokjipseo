import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { CloudRoot } from './features/cloud/CloudRoot';
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
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><CloudRoot><App /></CloudRoot></React.StrictMode>);

import './styles/recipe-results.css';
import './styles/recipe-detail.css';
import './styles/weekly-report.css';

import './styles/mypage-dashboard.css';
import './styles/responsive.css';
import './styles/fridge-notifications.css';
import './styles/manual-reminder-test.css';
