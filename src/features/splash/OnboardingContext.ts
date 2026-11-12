import { createContext, useContext } from 'react';

export const OnboardingContext = createContext({
  guidePending: false,
  welcomeRequested: false,
  requestWelcome: () => {},
});
export const useOnboarding = () => useContext(OnboardingContext);
