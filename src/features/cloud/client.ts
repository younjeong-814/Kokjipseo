import { createClient } from '@supabase/supabase-js';
import { configureExternalRequests } from './externalRequests';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
// Fail closed if a server secret was accidentally assigned to the public variable.
export const cloudConfigured = Boolean(url && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && key?.startsWith('sb_publishable_'));
export const cloudUrl = cloudConfigured ? url! : null;
export const supabase = cloudConfigured ? createClient(url!,key!,{
  auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true},
}) : null;
if (supabase) configureExternalRequests({url:url!,key:key!,token:async () => (await supabase.auth.getSession()).data.session?.access_token ?? null});

export function authRedirectUrl() {
  // Supabase PKCE uses ?code=, while the existing app uses #screen.
  return new URL(import.meta.env.BASE_URL,window.location.origin).href;
}
