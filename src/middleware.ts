import { NextResponse, type NextRequest } from "next/server";

/**
 * Protects the dashboard with HTTP basic auth (username: admin, password: ADMIN_PASSWORD).
 * Webhook, OAuth and cron routes are excluded because Meta / Vercel need to reach them.
 */
export function middleware(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return new NextResponse("Set ADMIN_PASSWORD to enable the dashboard.", { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (user === "admin" && pass === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ConvertlySocial", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/instagram/webhook|api/instagram/connect|api/instagram/callback|api/cron|_next|favicon.ico).*)"],
};
