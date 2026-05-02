// ─────────────────────────────────────────────────────────────────────────────
//  js/app.js — Shared utilities used across every page
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, FUNCTIONS_URL, fmt, fmtDate, fmtMonth } from './supabase-client.js';
export { fmt, fmtDate, fmtMonth };

// ── Toast notifications ───────────────────────────────────────────────────────
export function toast(msg, type = 'info', ms = 4200) {
  let wrap = document.getElementById('toasts');
  if (!wrap) { wrap = Object.assign(document.createElement('div'), { id: 'toasts' }); document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${{ success:'✓', error:'✕', info:'◆', warn:'⚠' }[type]||'◆'}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 400); }, ms);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
export function openModal(id)  { document.getElementById(id)?.classList.add('show'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }
document.addEventListener('click', e => { if (e.target.matches('.overlay')) e.target.classList.remove('show'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show')); });

// ── Auth guards ───────────────────────────────────────────────────────────────
export async function requireAuth(redirect = '/pages/login.html') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = redirect; return null; }
  return session;
}
export async function requireAdmin(redirect = '/') {
  const session = await requireAuth();
  if (!session) return null;
  const { data: p } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (p?.role !== 'admin') { window.location.href = redirect; return null; }
  return session;
}

// ── Nav renderer ──────────────────────────────────────────────────────────────
export async function renderNav(sel = '.nav-right') {
  const el = document.querySelector(sel);
  if (!el) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    el.innerHTML = `
      <a href="/pages/charities.html" class="nav-link">Charities</a>
      <a href="/pages/how-it-works.html" class="nav-link">How It Works</a>
      <a href="/pages/login.html" class="btn btn-ghost btn-sm">Sign In</a>
      <a href="/pages/login.html#register" class="btn btn-gold btn-sm">Get Started</a>`;
    return;
  }
  const { data: p } = await supabase.from('profiles').select('role,name').eq('id', session.user.id).single();
  el.innerHTML = `
    <a href="/pages/charities.html" class="nav-link hide-sm">Charities</a>
    <a href="/pages/dashboard.html" class="nav-link">Dashboard</a>
    ${p?.role==='admin' ? `<a href="/pages/admin.html" class="nav-link" style="color:var(--gold)">Admin ◆</a>` : ''}
    <button onclick="doSignOut()" class="btn btn-ghost btn-sm">Sign Out</button>`;
}
window.doSignOut = async () => { await supabase.auth.signOut(); window.location.href = '/'; };

// ── Panel switcher ────────────────────────────────────────────────────────────
export function showPanel(name, cb) {
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name)?.classList.add('active');
  document.querySelectorAll('[data-nav]').forEach(n => n.classList.toggle('active', n.dataset.nav === name));
  if (cb) cb(name);
}

// ── Draw engine (client-side) ─────────────────────────────────────────────────
export function randomDraw() {
  const p = Array.from({ length: 45 }, (_, i) => i + 1);
  const r = [];
  while (r.length < 5) { const i = Math.floor(Math.random() * p.length); r.push(p.splice(i, 1)[0]); }
  return r.sort((a, b) => a - b);
}

export async function algorithmicDraw(mode = 'frequent') {
  const { data: subs } = await supabase.from('subscriptions').select('user_id').eq('status', 'active');
  if (!subs?.length) return randomDraw();
  const uids = subs.map(s => s.user_id);
  const { data: scores } = await supabase.from('scores').select('score').in('user_id', uids);
  if (!scores?.length) return randomDraw();
  const freq = {};
  scores.forEach(s => { freq[s.score] = (freq[s.score] || 0) + 1; });
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);
  const w    = pool.map(n => { const f = freq[n] || 1; return mode === 'frequent' ? f : 1/f; });
  const tot  = w.reduce((a, b) => a + b, 0);
  const norm = w.map(x => x / tot);
  const out  = new Set();
  let tries  = 0;
  while (out.size < 5 && tries++ < 3000) {
    let r = Math.random(), cum = 0;
    for (let i = 0; i < pool.length; i++) { cum += norm[i]; if (r <= cum) { out.add(pool[i]); break; } }
  }
  for (const n of pool) { if (out.size >= 5) break; out.add(n); }
  return [...out].sort((a, b) => a - b);
}

export function calcPrizePool(activeSubs, plan, rollover = 0) {
  const avg  = plan === 'yearly' ? Math.round(8999 / 12) : 999;
  const pool = Math.round(activeSubs * avg * 0.50) + Number(rollover || 0);
  return { total: pool, match5: Math.round(pool * 0.40), match4: Math.round(pool * 0.35), match3: Math.round(pool * 0.25) };
}

export async function runDrawAndFindWinners(drawNumbers) {
  const set = new Set(drawNumbers);
  const { data: subs } = await supabase.from('subscriptions').select('user_id').eq('status', 'active');
  if (!subs?.length) return { 5: [], 4: [], 3: [] };
  const uids = subs.map(s => s.user_id);
  const { data: scores } = await supabase.from('scores').select('user_id,score').in('user_id', uids);
  const byUser = {};
  scores?.forEach(s => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s.score); });
  const result = { 5: [], 4: [], 3: [] };
  for (const [uid, nums] of Object.entries(byUser)) {
    const matched = nums.filter(n => set.has(n)).length;
    if (matched >= 3) result[matched]?.push(uid);
  }
  return result;
}

// ── Stripe helpers ────────────────────────────────────────────────────────────
export async function createCheckout(plan) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/pages/login.html'; return; }
  const res = await fetch(`${FUNCTIONS_URL}/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ plan }),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
  else toast(data.error || 'Failed to start checkout', 'error');
}

export async function openCustomerPortal() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const res = await fetch(`${FUNCTIONS_URL}/customer-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
  else toast(data.error || 'Could not open billing portal', 'error');
}
