-- platform-settings.sql
-- Run this in Supabase SQL Editor (or via migrate.js) once.

-- ── 1. avatar_url column on profiles ─────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ── 2. platform_settings table ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz DEFAULT now()
);

-- Default crypto deposit address rows (admin will overwrite via ops panel)
INSERT INTO public.platform_settings (key, value) VALUES
  ('crypto_ETH',   ''),
  ('crypto_USDT',  ''),
  ('crypto_USDC',  ''),
  ('crypto_WBTC',  ''),
  ('crypto_BNB',   ''),
  ('crypto_LINK',  ''),
  ('crypto_UNI',   ''),
  ('crypto_DAI',   ''),
  ('crypto_SHIB',  ''),
  ('crypto_AAVE',  '')
ON CONFLICT (key) DO NOTHING;

-- ── 3. RLS for platform_settings ─────────────────────────────
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can read settings (needed for deposit address display)
CREATE POLICY "settings_public_read" ON public.platform_settings
  FOR SELECT USING (true);

-- Only admins can write
CREATE POLICY "settings_admin_write" ON public.platform_settings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── 4. kyc_documents table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  front_url        text,
  back_url         text,
  selfie_url       text,
  proof_address_url text,
  status           text DEFAULT 'pending',
  submitted_at     timestamptz DEFAULT now(),
  reviewed_at      timestamptz,
  reviewer_notes   text
);

ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;

-- Users can see their own KYC docs; admins see all
CREATE POLICY "kyc_docs_owner_read" ON public.kyc_documents
  FOR SELECT USING (auth.uid() = user_id OR is_admin());

-- Users insert their own; admins can update (approve/reject)
CREATE POLICY "kyc_docs_owner_insert" ON public.kyc_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "kyc_docs_admin_update" ON public.kyc_documents
  FOR UPDATE USING (is_admin());

-- ── 5. Storage buckets (run in SQL Editor) ────────────────────
-- NOTE: Create these buckets manually in Supabase Dashboard → Storage:
--   • "avatars"   — Public bucket (profile photos)
--   • "kyc-docs"  — Private bucket (KYC documents, admin access only)
--
-- Or insert directly:
INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('kyc-docs', 'kyc-docs', false)
  ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to avatars bucket (their own file)
CREATE POLICY "avatars_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND auth.role() = 'authenticated'
  );

CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to upload their own KYC docs
CREATE POLICY "kyc_docs_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'kyc-docs' AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only admins (via service role) or the owner can read KYC docs
CREATE POLICY "kyc_docs_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'kyc-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_admin())
  );
