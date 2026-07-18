// config.example.js
//
// Copy this file to config.js, fill in your own values, and commit config.js.
// config.js is what the app actually loads (index.html references it); this
// example exists only as a template and as documentation of what config.js
// should contain.
//
// Where to find these — Supabase dashboard -> Project Settings -> API:
//   - SUPABASE_URL      : the "Project URL", e.g. https://abcdefgh.supabase.co
//   - SUPABASE_ANON_KEY : the "anon public" key
//
// The anon key is SAFE to commit — it is public by design and is governed by
// Row Level Security, so every visitor's browser receives it anyway. NEVER put
// the service_role key here; that one bypasses security and belongs only in the
// `today` Edge Function's secret.

window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY"
};
