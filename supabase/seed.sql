-- =====================================================================
--  Par4Good — Seed Data
--  Run AFTER schema.sql
-- =====================================================================

-- ── CHARITIES ─────────────────────────────────────────────────────────
INSERT INTO public.charities (name, description, mission, website, image_url, events, featured, total_received) VALUES

('Golf for Good',
 'Bringing the joy of golf to underprivileged youth communities across the UK. We run free coaching clinics, provide equipment and create pathways into the game for kids who could never otherwise afford to play.',
 'Our mission is to make golf accessible to every young person, regardless of background or income.',
 'https://golfforgood.org',
 'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=800&q=80',
 '[{"name":"Spring Youth Open","date":"2026-05-15","location":"St Andrews, Scotland"},{"name":"Summer Coaching Camp","date":"2026-07-20","location":"Royal Birkdale, Southport"},{"name":"Junior Masters","date":"2026-09-12","location":"Wentworth, Surrey"}]',
 TRUE, 2450000),

('The Caddy Foundation',
 'Supporting the mental health and wellbeing of professional and amateur caddies through counselling, community events and emergency financial aid. Behind every great golfer is a caddy — we make sure they are looked after too.',
 'To provide mental health resources and financial support to the unsung heroes of golf.',
 'https://caddyfoundation.org',
 'https://images.unsplash.com/photo-1593111774240-d529f12cf4bb?w=800&q=80',
 '[{"name":"Mental Health Golf Day","date":"2026-06-10","location":"Royal Birkdale"},{"name":"Caddy Cup Charity Match","date":"2026-08-22","location":"Gleneagles, Scotland"}]',
 FALSE, 1280000),

('Green Fairways Trust',
 'Protecting natural habitats and biodiversity on and around golf courses across the UK. We partner with clubs to create wildlife corridors, reduce chemical usage and restore wetlands and meadows.',
 'To transform golf courses into havens for wildlife and model sustainable land management.',
 'https://greenfairways.org',
 'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=800&q=80',
 '[{"name":"Rewilding Weekend","date":"2026-04-19","location":"Various UK clubs"},{"name":"Green Golf Summit","date":"2026-10-05","location":"Birmingham NEC"}]',
 FALSE, 890000),

('Open Arms Golf',
 'Using the power of golf as therapy for veterans and serving military personnel dealing with PTSD, combat-related injuries and transition challenges. Golf gives purpose, peace and camaraderie to those who served.',
 'To use golf as a vehicle for healing, rehabilitation and community for our armed forces.',
 'https://openarmsgolf.org',
 'https://images.unsplash.com/photo-1622397815439-b3c044e7ef33?w=800&q=80',
 '[{"name":"Veterans Cup 2026","date":"2026-09-05","location":"Carnoustie, Scotland"},{"name":"Remembrance Charity Day","date":"2026-11-08","location":"Augusta National"}]',
 FALSE, 560000),

('Putting for Parkinson''s',
 'Funding world-class Parkinson''s disease research through golf events and awareness campaigns. Every putt we make helps researchers get closer to a cure. Join us in putting for a purpose.',
 'To raise awareness and fund research into Parkinson''s disease through the golf community.',
 'https://puttingforparkinsons.org',
 'https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=800&q=80',
 '[{"name":"Charity Pro-Am","date":"2026-05-30","location":"Sunningdale, Berkshire"}]',
 FALSE, 320000);

-- ── SAMPLE PUBLISHED DRAWS ─────────────────────────────────────────────
INSERT INTO public.draws (month, draw_type, numbers, status, prize_pool_total, match5_amount, match4_amount, match3_amount, active_subscribers, published_at)
VALUES
  ('2026-03', 'random',        ARRAY[7,14,22,31,38],  'published', 149850, 59940, 52448, 37463, 150, NOW() - INTERVAL '4 weeks'),
  ('2026-04', 'algorithmic',   ARRAY[3,19,27,35,42],  'published', 163800, 65520, 57330, 40950, 164, NOW() - INTERVAL '2 days');

-- ── ADMIN USER SETUP ───────────────────────────────────────────────────
-- After running schema.sql and seed.sql:
--
-- 1. Go to Supabase Dashboard → Authentication → Users → Add user
--    Email: admin@par4good.com  Password: (your choice)
--
-- 2. Run this SQL to grant admin role:
--    UPDATE public.profiles
--    SET role = 'admin'
--    WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@par4good.com');
--
-- 3. To create test subscriber:
--    Register via the website signup form, then subscribe via dashboard.
