// Access guard. Mesa is local-only by default: requests addressed to localhost pass;
// anything else (LAN IP, tunnel hostname) needs MESA_TOKEN, sent as the
// x-mesa-token header, the mesa_token cookie, or ?token= once (which sets the cookie).
// If MESA_TOKEN is not set, non-local requests are refused.
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const COOKIE = "mesa_token";

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (LOCAL_HOST.test(host)) return NextResponse.next();

  const token = process.env.MESA_TOKEN;
  if (!token) {
    return new NextResponse("Mesa only answers on localhost. Set MESA_TOKEN to allow remote access.", { status: 403 });
  }

  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery === token) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete("token");
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: true, maxAge: 60 * 60 * 24 * 30, path: "/" });
    return res;
  }

  const given = req.headers.get("x-mesa-token") ?? req.cookies.get(COOKIE)?.value;
  if (given !== token) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
