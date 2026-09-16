# Comment → DM

A self-hosted "comment a keyword, get a DM" automation for Instagram, the same growth tool
ManyChat sells. Someone comments **GUIDE** on your Reel, your account replies publicly
("Sent it to your DMs 💌") and privately sends them the link. No per-contact pricing, and
your audience data stays in your own database.

Built with Next.js (runs on Vercel), Supabase (rules, tokens, activity log) and the official
Instagram API with Instagram Login.

## How it works

1. Meta sends a webhook to `/api/instagram/webhook` for every comment on your posts.
2. The app checks the signature, finds the first active automation whose keywords match
   (post-specific rules beat account-wide ones) and skips your own comments and duplicates.
3. It posts one of your public replies under the comment (optional) and sends the DM as an
   Instagram **private reply**, which is allowed for 7 days after the comment, once per comment,
   without the person having messaged you first.
4. Every comment is logged on the dashboard as `sent`, `skipped` or `failed` with the reason.

## One-time setup

### 1. Meta app (about 15 minutes)

1. Your Instagram account must be a **Business** or **Creator** account (Settings → Account type).
2. Go to <https://developers.facebook.com/apps> → **Create app** → choose **Other** → **Business**.
3. In the app dashboard add the **Instagram** product, then open
   **Instagram → API setup with Instagram login**.
4. Under "Generate access tokens" add your Instagram account as an Instagram tester, then
   accept the invite in the Instagram app (Settings → Apps and websites → Tester invites).
5. Note the **Instagram app ID** and **Instagram app secret** from that page.
6. Under **Set up Instagram business login** add the redirect URI
   `https://YOUR-DOMAIN/api/instagram/callback`.
7. Under **Configure webhooks** set the callback URL to
   `https://YOUR-DOMAIN/api/instagram/webhook`, choose a verify token (any random string),
   and subscribe to the `comments` field. Save this only after the app is deployed
   (step 3), because Meta verifies the URL immediately.

The webhook fires for comments on your own posts, in Development mode as well, as long as the
account that receives the comment is a tester on the app. To send DMs to the general public
you need to submit the app for **App Review** for `instagram_business_manage_messages` and
`instagram_business_manage_comments` and switch the app to **Live**. The review is a short
screencast showing the comment → DM flow; this app's dashboard is what you record.

### 2. Supabase

1. Create a project, open the **SQL editor** and run `supabase/migrations/0001_init.sql`.
2. Copy the **Project URL** and the **service_role** key (Project settings → API).

### 3. Deploy to Vercel

1. Import this repo in Vercel.
2. Add the environment variables from `.env.example` (the important ones are
   `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`, `APP_URL`,
   `ADMIN_PASSWORD`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
3. Deploy, then finish step 1.7 (save the webhook URL in the Meta dashboard).

The weekly cron in `vercel.json` refreshes the 60-day Instagram token so it never expires.

### 4. Connect and create the first automation

1. Open your deployment, log in with user `admin` and your `ADMIN_PASSWORD`.
2. Click **Connect Instagram** and approve the permissions. The app stores a long-lived token
   and subscribes the account to comment webhooks.
3. Click **New automation**, type the keyword(s), the public replies and the DM text.
   Use `{{username}}` and `{{link}}` in the DM. Set a button title to send a tappable button.
4. Leave "Post / Reel ID" empty to run on every post, or use **Pick a post** on the home
   page to scope the rule to one Reel.
5. Comment the keyword on your own post from a second account and watch the activity log.

## Local development

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

Simulate a comment without touching Meta (the request is signed with your app secret):

```bash
npx tsx scripts/simulate-comment.ts "guide please"
```

Tests and typecheck:

```bash
npm test
npm run typecheck
```

## Running without a database

Set `AUTOMATIONS_JSON` plus `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` and the app
works with no Supabase at all. Rules then live in the environment variable and the activity
log resets on every deploy, so this mode is best for a quick single-post test.

## Project layout

```
src/app/api/instagram/webhook   Meta webhook (GET verify, POST comments)
src/app/api/instagram/connect   starts the Instagram OAuth flow
src/app/api/instagram/callback  stores the long-lived token, subscribes webhooks
src/app/api/cron/refresh-tokens weekly token refresh (Vercel cron)
src/app                         dashboard: automations, post picker, activity log
src/lib/instagram.ts            Instagram API client (private replies, comment replies, OAuth)
src/lib/matching.ts             keyword matching and rule selection
src/lib/runner.ts               the comment → reply → DM pipeline
src/lib/store.ts                Supabase store, plus an in-memory fallback
supabase/migrations             database schema
scripts/simulate-comment.ts     fires a signed fake webhook at a local server
```

## Limits worth knowing

- One private reply per comment, and only within 7 days of the comment.
- Private replies only work for comments on your own posts (not on ads or live videos).
- Instagram counts DM automation toward messaging rate limits; a normal creator account is
  nowhere near them.
- The Meta developer docs are the source of truth for the API shapes used here:
  <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login>.
