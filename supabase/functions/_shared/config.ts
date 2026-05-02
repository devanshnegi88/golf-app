// supabase/functions/_shared/config.ts
export const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')!;
export const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
export const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
export const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
export const SITE_URL              = Deno.env.get('SITE_URL') || 'https://your-project.vercel.app';
export const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') || '';

export const PRICE_IDS = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY')!,
  yearly:  Deno.env.get('STRIPE_PRICE_YEARLY')!,
};

export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
