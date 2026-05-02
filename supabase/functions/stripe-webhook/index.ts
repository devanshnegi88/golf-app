// supabase/functions/stripe-webhook/index.ts
//
// Configure in Stripe Dashboard → Developers → Webhooks → Add endpoint
// URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//
// Events to enable:
//   checkout.session.completed
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_succeeded
//   invoice.payment_failed

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@13?target=deno';
import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, CORS } from '../_shared/config.ts';

const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ── Verify Stripe signature ───────────────────────────────────────────────
  const sig  = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 });
  }

  // ── Idempotency guard ────────────────────────────────────────────────────
  const { data: already } = await supabase
    .from('stripe_events').select('id').eq('id', event.id).maybeSingle();
  if (already) {
    return new Response(JSON.stringify({ received: true, skipped: true }), { status: 200 });
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  try {
    switch (event.type) {

      // ── Checkout completed ─────────────────────────────────────────────
      case 'checkout.session.completed': {
        const sess = event.data.object as Stripe.Checkout.Session;
        if (sess.mode !== 'subscription') break;

        const userId = sess.metadata?.supabase_user_id;
        const plan   = sess.metadata?.plan as 'monthly' | 'yearly';
        if (!userId) { console.error('No supabase_user_id in metadata'); break; }

        const sub = await stripe.subscriptions.retrieve(sess.subscription as string);
        await upsertSub(userId, sub, plan);

        // Log subscription payment
        await supabase.from('payments').insert({
          user_id:      userId,
          amount_pence: sub.items.data[0]?.price?.unit_amount || 0,
          currency:     sub.currency || 'gbp',
          type:         'subscription',
          status:       'paid',
          stripe_pi:    sess.payment_intent as string || null,
          reference:    sub.id,
        });

        // Auto charity contribution
        await recordCharityContribution(userId, sub.items.data[0]?.price?.unit_amount || 0);
        break;
      }

      // ── Subscription created / updated ────────────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub    = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id || await userFromCustomer(sub.customer as string);
        if (!userId) break;
        const plan   = (sub.metadata?.plan || guessPlan(sub.items.data[0]?.price?.id)) as 'monthly' | 'yearly';
        await upsertSub(userId, sub, plan);
        break;
      }

      // ── Subscription deleted / cancelled ──────────────────────────────
      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id || await userFromCustomer(sub.customer as string);
        if (!userId) break;
        await supabase.from('subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        console.log(`Subscription cancelled for ${userId}`);
        break;
      }

      // ── Invoice paid → refresh period dates ──────────────────────────
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        if (!inv.subscription) break;
        const sub    = await stripe.subscriptions.retrieve(inv.subscription as string);
        const userId = sub.metadata?.supabase_user_id || await userFromCustomer(inv.customer as string);
        if (!userId) break;

        await supabase.from('subscriptions').update({
          status:               'active',
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
          end_date:             new Date(sub.current_period_end   * 1000).toISOString().slice(0, 10),
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at:           new Date().toISOString(),
        }).eq('stripe_subscription_id', sub.id);

        // Log payment
        await supabase.from('payments').insert({
          user_id:      userId,
          amount_pence: inv.amount_paid,
          currency:     inv.currency,
          type:         'subscription',
          status:       'paid',
          reference:    inv.id,
        });

        // Monthly charity contribution
        await recordCharityContribution(userId, inv.amount_paid);
        break;
      }

      // ── Invoice payment failed ────────────────────────────────────────
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        if (!inv.subscription) break;
        await supabase.from('subscriptions')
          .update({ status: 'lapsed', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', inv.subscription as string);
        console.warn(`Payment failed: ${inv.subscription}`);
        break;
      }

      default:
        console.log(`Unhandled: ${event.type}`);
    }

    // Record processed event
    await supabase.from('stripe_events').insert({ id: event.id, type: event.type, payload: event });
    return new Response(JSON.stringify({ received: true }), { status: 200 });

  } catch (err) {
    console.error(`Error in ${event.type}:`, err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function upsertSub(userId: string, sub: Stripe.Subscription, plan: string) {
  const status  = mapStatus(sub.status);
  const amount  = sub.items.data[0]?.price?.unit_amount || 0;
  const periodStart = new Date(sub.current_period_start * 1000).toISOString();
  const periodEnd   = new Date(sub.current_period_end   * 1000).toISOString();

  const { error } = await supabase.from('subscriptions').upsert({
    user_id:                userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id:     sub.customer as string,
    stripe_price_id:        sub.items.data[0]?.price?.id,
    status,
    plan,
    amount_pence:           amount,
    start_date:             new Date(sub.start_date * 1000).toISOString().slice(0, 10),
    end_date:               periodEnd.slice(0, 10),
    current_period_start:   periodStart,
    current_period_end:     periodEnd,
    cancel_at_period_end:   sub.cancel_at_period_end,
    updated_at:             new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) console.error('upsertSub error:', error);
  else console.log(`Sub upserted: user=${userId} plan=${plan} status=${status}`);
}

async function userFromCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase.rpc('user_id_from_stripe_customer', { cus_id: customerId });
  return data || null;
}

function guessPlan(priceId?: string): string {
  const monthly = Deno.env.get('STRIPE_PRICE_MONTHLY');
  const yearly  = Deno.env.get('STRIPE_PRICE_YEARLY');
  return priceId === yearly ? 'yearly' : 'monthly';
}

function mapStatus(s: Stripe.Subscription.Status): string {
  const map: Record<string, string> = {
    active: 'active', trialing: 'active', past_due: 'lapsed',
    unpaid: 'lapsed', canceled: 'cancelled', incomplete: 'inactive',
    incomplete_expired: 'cancelled', paused: 'inactive',
  };
  return map[s] || 'inactive';
}

async function recordCharityContribution(userId: string, totalPence: number) {
  // Get user's charity_id and charity_percent
  const { data: profile } = await supabase
    .from('profiles').select('charity_id, charity_percent').eq('id', userId).single();
  if (!profile?.charity_id) return;

  const charityAmt = Math.round(totalPence * (profile.charity_percent || 10) / 100);
  if (charityAmt <= 0) return;

  // Log charity payment
  await supabase.from('payments').insert({
    user_id:     userId,
    amount_pence: charityAmt,
    type:        'charity_auto',
    charity_id:  profile.charity_id,
    status:      'paid',
  });

  // Increment charity total
  const { data: charity } = await supabase.from('charities')
    .select('total_received').eq('id', profile.charity_id).single();
  if (charity) {
    await supabase.from('charities')
      .update({ total_received: (charity.total_received || 0) + charityAmt })
      .eq('id', profile.charity_id);
  }
}
