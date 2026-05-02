// supabase/functions/customer-portal/index.ts
// Opens Stripe Customer Portal — manage billing, cancel, change plan.
// POST (no body) → { url: string }

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@13?target=deno';
import { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SITE_URL, CORS, json } from '../_shared/config.ts';

const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await supabase
      .from('profiles').select('stripe_customer_id').eq('id', user.id).single();

    if (!profile?.stripe_customer_id)
      return json({ error: 'No Stripe customer found. Subscribe first.' }, 404);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: `${SITE_URL}/pages/dashboard.html#subscription`,
    });

    return json({ url: portalSession.url });

  } catch (err) {
    console.error('customer-portal:', err);
    return json({ error: err.message }, 500);
  }
});
