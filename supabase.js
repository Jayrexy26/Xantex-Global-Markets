// Xantex Global Markets — Supabase client
// Loaded after the Supabase CDN <script> tag in each page.
// Paste your values from: Supabase Dashboard → Settings → API

const SUPABASE_URL  = 'https://ywnpzjjpighjhhqoxtsj.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3bnB6ampwaWdoamhocW94dHNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1Mjc4OTUsImV4cCI6MjA5MzEwMzg5NX0.lfeKjFfNsCoy1UaQ0ASIUD08fUq8mhY-1gbMPzrjYDE';

window.XANTEX_DB = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Admin panel routes to the live-data project's Edge Function
window.XANTEX_ADMIN_API_URL = 'https://xdcscknfomlzwysczegc.supabase.co/functions/v1/admin-api';
