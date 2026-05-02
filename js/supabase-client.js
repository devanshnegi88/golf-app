// ─────────────────────────────────────────────────────────────────────────────
//  js/supabase-client.js
//  Replace the two constants below with your Supabase project values.
//  Dashboard → Settings → API → Project URL & anon key
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL      = 'https://yjvdnwmdqdzefmwtjyod.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_SPTsz5T1JVba5b5WTGJhLA_4xK8vC2G';

// Edge Functions base URL (same project)


export const FUNCTIONS_URL = SUPABASE_URL + '/functions/v1';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export const PLANS = {
  monthly: { id: 'monthly', label: 'Monthly',  amount: 999,  display: '9.99',  per: 'per month' },
  yearly:  { id: 'yearly',  label: 'Yearly',   amount: 8999, display: '89.99', per: 'per year'  }
};

export const POOL_RATE    = 0.50;
export const CHARITY_MIN  = 0.10;
export const MATCH_SPLITS = { 5: 0.40, 4: 0.35, 3: 0.25 };

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

export async function getFullUser(userId) {
  const [{ data: profile }, { data: sub }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  return profile ? { ...profile, subscription: sub } : null;
}

export function hasActiveSub(user) {
  return user && user.subscription && user.subscription.status === 'active';
}

export function fmtMoney(pence) {
  if (!pence && pence !== 0) return '--';
  return 'GBP ' + (Number(pence) / 100).toFixed(2);
}

export function fmt(pence) {
  if (!pence && pence !== 0) return '--';
  return '\u00a3' + (Number(pence) / 100).toFixed(2);
}

export function fmtDate(d) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

export function fmtMonth(m) {
  if (!m) return '--';
  var parts = m.split('-');
  var y = parts[0];
  var mo = parts[1];
  return new Date(Number(y), Number(mo) - 1).toLocaleString('en-GB', {
    month: 'long', year: 'numeric'
  });
}

export function timeAgo(d) {
  if (!d) return '';
  var diff = (Date.now() - new Date(d)) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}