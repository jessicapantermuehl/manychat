import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { defaultClientFor, handleCommentEvents } from "@/lib/runner";
import { getStore } from "@/lib/store";
import { handleVerification, parseCommentEvents, verifySignature } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta calls this once when you save the webhook URL in the app dashboard. */
export async function GET(req: Request) {
  const result = handleVerification(new URL(req.url).searchParams, env.verifyToken);
  if (result.ok) return new Response(result.challenge, { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

/** Meta POSTs here for every comment on the connected account's posts. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature, env.appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (env.debugWebhooks) console.log("[webhook]", rawBody);

  const events = parseCommentEvents(payload);
  const store = getStore();

  // Meta expects a 200 quickly; the API calls are fast enough to do inline on a serverless function.
  const results = await handleCommentEvents(events, {
    store,
    clientFor: (igUserId) => defaultClientFor(store, igUserId),
    log: (msg, extra) => console.error("[ConvertlySocial]", msg, extra),
  });

  return NextResponse.json({ received: events.length, results: results.map((r) => ({ commentId: r.commentId, status: r.status, detail: r.detail })) });
}
