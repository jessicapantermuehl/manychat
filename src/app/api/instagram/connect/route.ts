import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { buildAuthorizeUrl } from "@/lib/instagram";

export const dynamic = "force-dynamic";

/** Starts the "Connect Instagram" OAuth flow. */
export async function GET(req: Request) {
  if (!env.appId) return NextResponse.json({ error: "INSTAGRAM_APP_ID is not set" }, { status: 500 });
  const origin = env.appUrl || new URL(req.url).origin;
  const redirectUri = `${origin}/api/instagram/callback`;
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(env.appId, redirectUri, state));
  res.cookies.set("ig_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
