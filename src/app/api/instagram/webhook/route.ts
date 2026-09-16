import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { defaultClientFor, defaultGhlClient, handleCommentEvents, handleMessageEvents } from "@/lib/runner";
import { getStore } from "@/lib/store";
import { handleVerification, parseCommentEvents, parseMessageEvents, verifySignature } from "@/lib/webhook";

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

  const comments = parseCommentEvents(payload);
  const messages = parseMessageEvents(payload);
  const store = getStore();
  const deps = {
    store,
    clientFor: (igUserId: string) => defaultClientFor(store, igUserId),
    ghlClient: defaultGhlClient,
    log: (msg: string, extra?: unknown) => console.error("[ConvertlySocial]", msg, extra),
  };

  // Meta expects a 200 quickly; the API calls are fast enough to do inline on a serverless function.
  const results = [...(await handleCommentEvents(comments, deps)), ...(await handleMessageEvents(messages, deps))];

  return NextResponse.json({
    received: comments.length + messages.length,
    results: results.map((r) => ({ commentId: r.commentId, status: r.status, detail: r.detail })),
  });
}
