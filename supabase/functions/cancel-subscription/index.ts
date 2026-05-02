// supabase/functions/cancel-subscription/index.ts
// Cancels the user's Stripe subscription at period end.
// POST (no body) → { message, end_date }

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@13?target=deno';
import { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CORS, json } from '../_shared/config.ts';

const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    // Get subscription
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id, status, end_date')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!sub?.stripe_subscription_id)
      return json({ error: 'No active Stripe subscription found' }, 404);

    // Cancel at period end in Stripe
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Update DB
    await supabase.from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);

    return json({
      message:  'Subscription will cancel at end of current period',
      end_date: new Date(updated.current_period_end * 1000).toISOString().slice(0, 10),
    });

  } catch (err) {
    console.error('cancel-subscription:', err);
    return json({ error: err.message }, 500);
  }
});
