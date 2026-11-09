import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/access";
import { repos } from "@/lib/repo";

export const dynamic = "force-dynamic";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

const page = (status: number, title: string, text: string) =>
  new NextResponse(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Mesa</title>` +
      `<body style="font:16px/1.5 system-ui,sans-serif;background:#eceae5;color:#1c1d21;margin:0;padding:32px 24px"><h1 style="font-size:21px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#3e4047">${text}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

/**
 * GET /pair?c=<one-time code>: the link inside the QR on /telefono. A valid code (single use, 10 min, stored hashed)
 * sets the mesa_token cookie (httpOnly, Secure, SameSite=Strict, 30 days) and sends the phone to /. The token is never
 * in a URL: the code is, and it is dead after this request. The redirect is relative so it works behind any Host.
 */
export function GET(req: Request) {
  const token = process.env.MESA_TOKEN;
  if (!token) return page(403, "Mesa no acepta teléfonos todavía", "Falta configurar MESA_TOKEN en la PC.");
  const code = new URL(req.url).searchParams.get("c") ?? "";
  if (!repos().pairing.consume(code)) {
    return page(410, "Código vencido o ya usado", "Cada código vale 10 minutos y una sola vez. En tu PC abre Mesa, Teléfono, y genera uno nuevo.");
  }
  const res = new NextResponse(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
  res.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", maxAge: THIRTY_DAYS, path: "/" });
  return res;
}
