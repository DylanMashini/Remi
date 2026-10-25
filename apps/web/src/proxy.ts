import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no cookie means "send to /login". The real check is requireSession()
// in each page and route handler. API routes are never intercepted (they return 401 JSON).
export function proxy(request: NextRequest) {
  if (request.cookies.has("recall_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  // Visitors see the landing page at "/" (URL unchanged); signed-in users get Today there.
  if (request.nextUrl.pathname === "/") {
    url.pathname = "/welcome";
    return NextResponse.rewrite(url);
  }
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except API, auth pages, Next internals, and files with an extension.
    "/((?!api/|api$|login|signup|forgot|reset|join|welcome|_next/|.*\\.[^/]+$).*)",
  ],
};
