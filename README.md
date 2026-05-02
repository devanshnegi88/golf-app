# Par4Good — Complete Full-Stack Golf Charity Platform

> Play Golf. Give Back. Win Together.

Built with **pure HTML + CSS + JS** (no build step), **Supabase** (Postgres + Auth + Edge Functions) and **Stripe** (subscriptions + billing portal). Deployed on **Vercel** in one click.

---

## 📁 Project Structure

```
par4good/
├── index.html                          Public homepage
├── vercel.json                         Vercel routing config
│
├── css/
│   └── main.css                        Complete design system
│
├── js/
│   ├── supabase-client.js              Supabase init + shared helpers
│   └── app.js                          Auth, nav, draw engine, Stripe helpers
│
├── pages/
│   ├── login.html                      Sign in / Register
│   ├── subscribe.html                  Plan selection + Stripe checkout
│   ├── subscription-success.html       Post-checkout success page
│   ├── dashboard.html                  Subscriber dashboard (7 panels)
│   ├── charities.html                  Charity listing + search + donations
│   ├── how-it-works.html               Public explainer + FAQ
│   └── admin.html                      Admin panel (5 sections)
│
└── supabase/
    ├── schema.sql                      Complete DB schema + RLS + triggers
    ├── seed.sql                        Sample charities + draws
    └── functions/
        ├── _shared/config.ts           Shared env + CORS helpers
        ├── create-checkout/index.ts    Stripe Checkout Session
        ├── stripe-webhook/index.ts     All Stripe event handling
        ├── customer-portal/index.ts    Stripe Billing Portal
        ├── send-email/index.ts         Transactional emails (Resend)
        └── cancel-subscription/index.ts Cancel at period end
```

---

## 🚀 Deployment — Step by Step

### Step 1: Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → New project
2. Note your **Project URL** and **anon key** (Settings → API)
3. Also note your **service_role key** (keep this secret — Edge Functions only)

### Step 2: Run SQL Schema
1. Supabase Dashboard → **SQL Editor** → New query
2. Paste `supabase/schema.sql` → Run all
3. Paste `supabase/seed.sql` → Run all

### Step 3: Configure Supabase Keys
Edit `js/supabase-client.js`:
```js
export const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

### Step 4: Create Admin User
1. Supabase Dashboard → Authentication → Users → **Add user**
   - Email: `admin@par4good.com`  |  Password: *(your choice)*
2. SQL Editor → run:
```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@par4good.com');
```

### Step 5: Set Up Stripe

1. Create account at [stripe.com](https://stripe.com)
2. **Create two Products** (Dashboard → Products → Add product):
   - **Monthly**: £9.99/month recurring → copy price ID e.g. `price_xxx`
   - **Yearly**: £89.99/year recurring → copy price ID e.g. `price_yyy`
3. Enable **Customer Portal** (Stripe Dashboard → Settings → Billing → Customer portal)
4. Note your **Secret Key** and **Publishable Key**

### Step 6: Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Set environment variables
supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxx \
  STRIPE_PRICE_MONTHLY=price_xxx \
  STRIPE_PRICE_YEARLY=price_yyy \
  SITE_URL=https://your-project.vercel.app \
  RESEND_API_KEY=re_xxx

# Deploy all functions
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
supabase functions deploy customer-portal
supabase functions deploy send-email
supabase functions deploy cancel-subscription
```

### Step 7: Configure Stripe Webhook

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy **Signing secret** → add as `STRIPE_WEBHOOK_SECRET` env var

### Step 8: Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# From the par4good/ directory:
vercel

# Follow prompts:
# ✓ Link to new project
# ✓ Framework preset: Other
# ✓ Output directory: ./  (root)
# ✓ No build command needed
```

Or push to GitHub → [vercel.com/new](https://vercel.com/new) → Import → Deploy.

---

## 🔑 Environment Variables

| Variable | Where Used | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | Edge Functions | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | Webhook signing secret |
| `STRIPE_PRICE_MONTHLY` | create-checkout | Monthly plan price ID |
| `STRIPE_PRICE_YEARLY` | create-checkout | Yearly plan price ID |
| `SUPABASE_URL` | Edge Functions | Auto-set by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Auto-set by Supabase |
| `SITE_URL` | Edge Functions | Your Vercel URL |
| `RESEND_API_KEY` | send-email | Optional — email sending |

---

## 🗄️ Database Schema

| Table | Purpose |
|---|---|
| `profiles` | User profiles, charity choice, Stripe customer ID |
| `subscriptions` | Subscription state, Stripe IDs, plan, dates |
| `scores` | Stableford scores (max 5, rolling, 1 per date) |
| `charities` | Charity listings with events |
| `draws` | Monthly draws with numbers and prize pool |
| `draw_winners` | Winner records, proof, verification status |
| `payments` | All payment logs (subscription + charity) |
| `stripe_events` | Webhook idempotency log |
| `notifications` | Email send log |

---

## 🔒 Security

- **Supabase Auth** — JWT-based, session persisted in browser
- **Row Level Security** — every table locked down; users see only their own data
- **Admin bypass** via `is_admin()` database function
- **Score limit trigger** — 5-score max enforced in PostgreSQL, not just client-side
- **Duplicate date constraint** — unique index on (user_id, date)
- **Stripe** — all payment data stays in Stripe; we store only IDs
- **Edge Functions** — server-side Stripe calls; secret key never in browser

---

## 🧮 Business Logic

### Draw Engine
- **Random**: `crypto.getRandomValues`-seeded shuffle of 1–45, pick 5
- **Algorithmic (frequent)**: Weighted random — numbers appearing most in subscriber scores are more likely
- **Algorithmic (infrequent)**: Inverse weight — rarest scores are more likely

### Prize Pool Calculation
```
Monthly revenue = activeSubscribers × avgSubscriptionAmount
Prize pool      = revenue × 50%  +  any jackpot rollover
Jackpot (5M)    = pool × 40%  (rolls over if no winner)
4-Match         = pool × 35%  (split equally)
3-Match         = pool × 25%  (split equally)
```

### Charity Contributions
- Auto-calculated per payment via webhook
- Min 10%, user-configurable up to 100%
- Logged per payment in `payments` table
- Increments `charities.total_received` on each contribution

---

## ✅ Complete Testing Checklist (matches PRD)

**Public Visitor**
- [ ] View homepage with draw preview, charity spotlight, pricing
- [ ] Browse charities + search filter
- [ ] Read How It Works + FAQ
- [ ] View subscription plans
- [ ] Initiate signup from CTA

**Registration & Auth**
- [ ] Register new account
- [ ] Login / logout
- [ ] Password reset email
- [ ] Auto-redirect to dashboard after login

**Subscription Flow**
- [ ] Select monthly plan → Stripe Checkout → success page
- [ ] Select yearly plan → Stripe Checkout → success page
- [ ] Subscription shows as Active in dashboard
- [ ] Manage Billing → Stripe Customer Portal
- [ ] Cancel via portal → cancel_at_period_end = true
- [ ] Webhook updates DB on payment events

**Score Management**
- [ ] Add score 1–45 with date → appears in list
- [ ] Score < 1 or > 45 rejected
- [ ] Duplicate date rejected
- [ ] 6th score removes oldest automatically
- [ ] Edit score → updates correctly
- [ ] Delete score
- [ ] Scores show in reverse chronological order

**Draw Participation**
- [ ] Published draws visible on dashboard
- [ ] Matched numbers highlighted in green
- [ ] Draw balls shown correctly on homepage

**Charity System**
- [ ] Browse all charities
- [ ] Search filter works
- [ ] View charity detail + events
- [ ] Make independent donation
- [ ] Select charity from dashboard
- [ ] Set contribution % (10–100%)
- [ ] Contribution estimate shown correctly
- [ ] Auto charity payment logged on subscription renewal

**Winner Flow**
- [ ] Winner records created on draw publish
- [ ] Winner sees prize in dashboard
- [ ] Upload proof URL
- [ ] Admin sees pending winner
- [ ] Admin approves → status = verified
- [ ] Admin rejects with reason → status = rejected
- [ ] Admin marks paid → paid_at set
- [ ] Winner notified by email (if Resend configured)

**Admin Panel**
- [ ] Analytics: user count, revenue, charity totals, draw stats
- [ ] Users: list, search, edit name/role/subscription
- [ ] Users: view and delete individual scores
- [ ] Draws: create with random type
- [ ] Draws: create with algorithmic (frequent/infrequent)
- [ ] Draws: simulate → see winner preview
- [ ] Draws: publish → winner records created
- [ ] Winners: filter by status
- [ ] Winners: approve / reject with reason
- [ ] Winners: mark as paid
- [ ] Charities: add, edit, activate/deactivate, set featured

**Email Notifications**
- [ ] Welcome email on registration
- [ ] Payment receipt on subscription
- [ ] Draw results notification (all subscribers)
- [ ] Winner alert (matching players)
- [ ] Proof verification outcome

**Responsive Design**
- [ ] Homepage on mobile
- [ ] Dashboard on mobile (mobile nav tabs)
- [ ] Admin panel on mobile
- [ ] Charities grid on mobile

---

## 🧪 Test Credentials

| Role | How to create |
|---|---|
| Admin | Create via Supabase Auth dashboard, then run `UPDATE profiles SET role='admin'` |
| Subscriber | Register via /pages/login.html, then subscribe via dashboard |

---

## 📧 Email Setup (Optional)

1. Create account at [resend.com](https://resend.com)
2. Verify your domain
3. Create API key
4. Add `RESEND_API_KEY` to Supabase Edge Function secrets
5. Update `FROM` address in `send-email/index.ts` to your verified domain

If `RESEND_API_KEY` is not set, emails are logged to console but not sent — the platform works fully without it.

---

## 🔮 Scalability Notes (from PRD §14)

- **Multi-country**: Add `country` field to profiles, use Stripe's multi-currency support
- **Teams/Corporate**: Add `team_id` to profiles and subscriptions tables
- **Campaign module**: Add `campaigns` table with `active_from/to` dates
- **Mobile app**: All business logic is in Supabase; add React Native / Expo app calling same API
- **Edge Functions** are stateless and auto-scale on Supabase
