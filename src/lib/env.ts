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
