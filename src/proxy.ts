// Access guard (policy in src/lib/access.ts). Mesa is local-only by default: a request counts as local only
// when its Host is loopback and it carries no forwarding headers (Cf-*, X-Forwarded-*, Forwarded). Anything else
// needs a valid Cloudflare Access JWT (Cf-Access-Jwt-Assertion, verified here) AND the MESA_TOKEN cookie (set by the
// one-time pairing at /pair) or the x-mesa-token header. With MESA_TOKEN or the MESA_CF_ACCESS_* variables unset
// every forwarded request is refused. There is no ?token=: the token never travels in a URL.
// A page load that fails only on the pairing key gets a small form to type the 8-character code (see /pair).
// Next 16 runs this on the Node.js runtime, so the async JWT check and WebCrypto are available.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, decideAccess } from "@/lib/access";
import { cfAccessConfig } from "@/lib/cf-access";
import { isNavigation, unpairedPage } from "@/lib/pair-page";

export async function proxy(req: NextRequest) {
  const d = await decideAccess(
    {
      headers: req.headers,
      path: req.nextUrl.pathname,
      cookie: req.cookies.get(COOKIE)?.value,
      accessCookie: req.cookies.get("CF_Authorization")?.value,
    },
    { token: process.env.MESA_TOKEN, cf: cfAccessConfig(process.env) },
  );
  if (d.allow) return NextResponse.next();
  if (d.status === 401 && isNavigation(req.headers)) return unpairedPage();
  return new NextResponse(d.message, { status: d.status, headers: { "cache-control": "no-store", "x-mesa-guard": "1" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
