// supabase/functions/create-checkout/index.ts
// Creates a Stripe Checkout Session for monthly or yearly subscription.
// POST { plan: 'monthly' | 'yearly' }  →  { url: string }

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@13?target=deno';
import { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SITE_URL, PRICE_IDS, CORS, json } from '../_shared/config.ts';

const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    // ── Validate plan ────────────────────────────────────────────────────────
    const { plan } = await req.json() as { plan: string };
    if (!plan || !['monthly', 'yearly'].includes(plan))
      return json({ error: 'plan must be monthly or yearly' }, 400);

    const priceId = PRICE_IDS[plan as 'monthly' | 'yearly'];
    if (!priceId) return json({ error: `Stripe price ID for '${plan}' not configured in env vars` }, 500);

    // ── Get or create Stripe customer ────────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles').select('name, stripe_customer_id').eq('id', user.id).single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    user.email!,
        name:     profile?.name || user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    // ── Check existing active subscription ───────────────────────────────────
    const { data: existingSub } = await supabase
      .from('subscriptions').select('plan, status, stripe_subscription_id')
      .eq('user_id', user.id).eq('status', 'active').maybeSingle();

    if (existingSub?.plan === plan)
      return json({ error: 'Already subscribed to this plan', portal: true }, 409);

    // ── Create Checkout Session ──────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/pages/subscription-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/pages/subscribe.html`,
      subscription_data: {
        metadata: { supabase_user_id: user.id, plan },
      },
      metadata:    { supabase_user_id: user.id, plan },
      billing_address_collection: 'auto',
      allow_promotion_codes:      true,
    });

    return json({ url: session.url });

  } catch (err) {
    console.error('create-checkout:', err);
    return json({ error: err.message }, 500);
  }
});
