/**
 * Central place for reading environment variables.
 * Nothing here throws at import time so that builds and tests work without a full .env.
 */

export const env = {
  /** Meta app ID (from the Meta developer dashboard, Instagram product). */
  appId: process.env.INSTAGRAM_APP_ID ?? "",
  /** Meta app secret. Used to verify webhook signatures and exchange tokens. */
  appSecret: process.env.INSTAGRAM_APP_SECRET ?? "",
  /** Any random string; must match what you type into the Meta webhook config. */
  verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? "",
  /** Optional: a long-lived token for a single account (used when no DB row exists). */
  accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
  /** Optional: the IG user id that the env access token belongs to. */
  igUserId: process.env.INSTAGRAM_USER_ID ?? "",
  /** Graph API version, e.g. v21.0 */
  apiVersion: process.env.INSTAGRAM_API_VERSION ?? "v21.0",
  /** Public base URL of this deployment, e.g. https://dm.example.com (no trailing slash). */
  appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
  /** Password for the admin dashboard (HTTP basic auth). */
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  /** Secret that Vercel cron sends in the Authorization header. */
  cronSecret: process.env.CRON_SECRET ?? "",
  /** Anthropic API key. Enables intent matching, comment triage, FAQ answers and copy generation. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Claude model used for the AI features. */
  aiModel: process.env.AI_MODEL ?? "claude-opus-5",
  /** GoHighLevel private integration token (Settings → Private integrations, scope contacts.write). */
  ghlApiKey: process.env.GHL_API_KEY ?? "",
  /** GoHighLevel sub-account (location) id. */
  ghlLocationId: process.env.GHL_LOCATION_ID ?? "",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  /** Optional JSON array of automations, used when Supabase is not configured. */
  automationsJson: process.env.AUTOMATIONS_JSON ?? "",
  /** Set to "true" to log every webhook payload (useful while setting up). */
  debugWebhooks: process.env.DEBUG_WEBHOOKS === "true",
};

export function hasSupabase(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey);
}

export function hasGhl(): boolean {
  return Boolean(env.ghlApiKey && env.ghlLocationId);
}

export function hasAi(): boolean {
  return Boolean(env.anthropicApiKey);
}
