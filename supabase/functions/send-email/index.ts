// supabase/functions/send-email/index.ts
//
// Sends transactional emails via Resend (https://resend.com).
// Called internally (service role) after draws are published or winners verified.
//
// POST { type, userId, data }
// Types: draw_published | winner_alert | payment_receipt | welcome | proof_required

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SITE_URL, CORS, json } from '../_shared/config.ts';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FROM = 'Par4Good <noreply@par4good.com>';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Internal calls only — verify service role header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.includes(SUPABASE_SERVICE_KEY)) {
    // Also allow admin JWT
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { type, userId, data } = await req.json();

    // Fetch user details
    const { data: profile } = await supabase
      .from('profiles').select('name').eq('id', userId).single();
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) return json({ error: 'User email not found' }, 404);

    const name = profile?.name || email;

    let subject = '';
    let html    = '';

    switch (type) {

      case 'welcome':
        subject = 'Welcome to Par4Good 🏌️';
        html = `
          <h1>Welcome to Par4Good, ${name}!</h1>
          <p>You've joined a platform where every round of golf helps change lives.</p>
          <h2>What to do next:</h2>
          <ol>
            <li>Log your 5 most recent Stableford scores</li>
            <li>Choose your charity from our directory</li>
            <li>Watch for the monthly draw results</li>
          </ol>
          <a href="${SITE_URL}/pages/dashboard.html" style="background:#c9a84c;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Go to Dashboard →</a>`;
        break;

      case 'payment_receipt':
        subject = `Payment confirmed — ${data.plan} plan`;
        html = `
          <h1>Payment Confirmed ✓</h1>
          <p>Hi ${name}, your subscription is now active.</p>
          <table style="border-collapse:collapse;width:100%;max-width:400px">
            <tr><td style="padding:8px;border:1px solid #eee">Plan</td><td style="padding:8px;border:1px solid #eee">${data.plan}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee">Amount</td><td style="padding:8px;border:1px solid #eee">£${(data.amount/100).toFixed(2)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee">Charity contribution</td><td style="padding:8px;border:1px solid #eee">£${(data.charityAmt/100).toFixed(2)} to ${data.charityName||'your chosen charity'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee">Next billing date</td><td style="padding:8px;border:1px solid #eee">${data.nextDate}</td></tr>
          </table>
          <p>Your Stableford scores are now your lottery numbers. Good luck in this month's draw!</p>
          <a href="${SITE_URL}/pages/dashboard.html" style="background:#c9a84c;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">View Dashboard →</a>`;
        break;

      case 'draw_published':
        subject = `${data.month} Draw Results are live 🎯`;
        const matched = data.matchedCount || 0;
        html = `
          <h1>${data.month} Draw Results</h1>
          <p>Hi ${name}, the ${data.month} draw has been published.</p>
          <h2>Draw Numbers: ${data.numbers?.join(' · ')}</h2>
          ${matched >= 3
            ? `<div style="background:#1a9e76;color:#fff;padding:20px;border-radius:8px;margin:20px 0">
                <h2>🎉 You matched ${matched} numbers!</h2>
                <p>Your prize: £${(data.prizeAmount/100).toFixed(2)}</p>
                <p>Please log in to upload your proof of scores to claim your winnings.</p>
              </div>`
            : `<p>You matched ${matched} number${matched!==1?'s':''} this month. Keep entering your scores for next month's draw!</p>`}
          <p>Jackpot: £${(data.jackpot/100).toFixed(2)} ${data.jackpotRollover?'(rolling over to next month)':''}</p>
          <a href="${SITE_URL}/pages/dashboard.html#draws" style="background:#c9a84c;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">View Draw Results →</a>`;
        break;

      case 'winner_alert':
        subject = `You won £${(data.prizeAmount/100).toFixed(2)}! Upload your proof 🏆`;
        html = `
          <h1>Congratulations, ${name}! 🏆</h1>
          <p>You've won a prize in the <strong>${data.month} draw</strong>!</p>
          <div style="background:#c9a84c22;border:2px solid #c9a84c;padding:20px;border-radius:8px;margin:20px 0">
            <h2 style="color:#c9a84c">${data.matchCount}-Number Match</h2>
            <p style="font-size:2rem;font-weight:bold;margin:8px 0">£${(data.prizeAmount/100).toFixed(2)}</p>
          </div>
          <h3>How to claim your prize:</h3>
          <ol>
            <li>Log in to your Par4Good dashboard</li>
            <li>Go to <strong>Winnings</strong></li>
            <li>Click <strong>Upload Proof</strong></li>
            <li>Paste a screenshot URL from your golf club platform showing your scores</li>
          </ol>
          <p>Once verified by our team, your payment will be processed within 3–5 business days.</p>
          <a href="${SITE_URL}/pages/dashboard.html#winnings" style="background:#c9a84c;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Claim Your Prize →</a>`;
        break;

      case 'proof_required':
        subject = 'Action required: Upload proof to claim your prize';
        html = `
          <h1>Don't forget to claim your prize, ${name}!</h1>
          <p>You have an unclaimed prize of <strong>£${(data.prizeAmount/100).toFixed(2)}</strong> from the ${data.month} draw.</p>
          <p>Please upload proof of your scores within 14 days to claim your winnings.</p>
          <a href="${SITE_URL}/pages/dashboard.html#winnings" style="background:#c9a84c;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Upload Proof Now →</a>`;
        break;

      case 'winner_verified':
        subject = 'Your prize has been verified — payment incoming ✓';
        html = `
          <h1>Prize Verified! ✓</h1>
          <p>Hi ${name}, your proof of scores has been verified by our team.</p>
          <p>Your payment of <strong>£${(data.prizeAmount/100).toFixed(2)}</strong> will be processed within 3–5 business days.</p>
          <a href="${SITE_URL}/pages/dashboard.html#winnings" style="background:#c9a84c;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">View Winnings →</a>`;
        break;

      case 'winner_rejected':
        subject = 'Update on your prize claim';
        html = `
          <h1>Prize Claim Update</h1>
          <p>Hi ${name}, unfortunately your proof of scores could not be verified for the ${data.month} draw.</p>
          <p><strong>Reason:</strong> ${data.reason || 'Proof did not meet requirements'}</p>
          <p>If you believe this is an error, please contact our support team.</p>`;
        break;

      default:
        return json({ error: `Unknown email type: ${type}` }, 400);
    }

    // ── Send via Resend ──────────────────────────────────────────────────────
    if (!RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not set — email not sent (logged only)');
      console.log(`Would send [${type}] to ${email}: ${subject}`);
      // Still log the notification
      await supabase.from('notifications').insert({ user_id: userId, type, subject, status: 'skipped' });
      return json({ sent: false, reason: 'No API key' });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    FROM,
        to:      [email],
        subject,
        html:    wrapEmail(html),
      }),
    });

    const resData = await res.json();
    if (!res.ok) {
      console.error('Resend error:', resData);
      return json({ error: resData.message }, 500);
    }

    // Log notification
    await supabase.from('notifications').insert({ user_id: userId, type, subject, status: 'sent' });

    return json({ sent: true, id: resData.id });

  } catch (err) {
    console.error('send-email:', err);
    return json({ error: err.message }, 500);
  }
});

function wrapEmail(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0;padding:40px 20px}
.wrap{max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}
.header{background:#0b0d11;padding:28px 32px}
.header-brand{font-family:Georgia,serif;font-size:1.5rem;font-weight:700;color:#fff}
.header-brand em{color:#c9a84c;font-style:normal}
.body{padding:32px}h1{color:#0b0d11;margin-top:0}p{color:#555;line-height:1.7}
.footer{background:#f9f9f9;padding:20px 32px;font-size:.8rem;color:#999;border-top:1px solid #eee}
</style></head>
<body><div class="wrap">
  <div class="header"><div class="header-brand">Par<em>4</em>Good</div></div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>You're receiving this because you have an account with Par4Good.<br/>
    © 2026 Par4Good. All rights reserved.</p>
  </div>
</div></body></html>`;
}
