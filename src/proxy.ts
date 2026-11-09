// Access guard (policy in src/lib/access.ts). Mesa is local-only by default: a request counts as local only
// when its Host is loopback and it carries no forwarding headers (Tailscale-User-Login, X-Forwarded-*, Forwarded).
// Anything else needs the MESA_TOKEN cookie (set by the one-time pairing link at /pair) or the x-mesa-token
// header. With MESA_TOKEN unset every forwarded request is refused. There is no ?token= any more: the token
// never travels in a URL.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, decideAccess } from "@/lib/access";

export function proxy(req: NextRequest) {
  const d = decideAccess(
    { headers: req.headers, path: req.nextUrl.pathname, cookie: req.cookies.get(COOKIE)?.value },
    { token: process.env.MESA_TOKEN, tailscaleUser: process.env.MESA_TAILSCALE_USER },
  );
  if (d.allow) return NextResponse.next();
  return new NextResponse(d.message, { status: d.status, headers: { "cache-control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
