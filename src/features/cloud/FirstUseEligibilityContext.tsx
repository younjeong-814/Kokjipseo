import { createContext, useContext } from 'react';

export type FirstUseEligibility = { loaded: boolean; hasUsedAppBefore: boolean };
export const FirstUseEligibilityContext = createContext<FirstUseEligibility>({ loaded: true, hasUsedAppBefore: false });
export function useFirstUseEligibility() { return useContext(FirstUseEligibilityContext); }
