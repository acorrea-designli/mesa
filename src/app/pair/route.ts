import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/access";
import { pairPage } from "@/lib/pair-page";
import { repos } from "@/lib/repo";

export const dynamic = "force-dynamic";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

const noToken = () => pairPage({ status: 403, title: "Mesa no acepta teléfonos todavía", text: "Falta configurar MESA_TOKEN en la PC." });

function redeem(input: string, token: string): Response {
  const result = repos().pairing.redeem(input);
  if (result === "limited") {
    return pairPage({ status: 429, title: "Demasiados intentos", text: "Espera 10 minutos o genera un código nuevo en tu PC: Mesa, Teléfono.", form: true });
  }
  if (result === "invalid") {
    return pairPage({
      status: 410,
      title: "Código vencido o ya usado",
      text: "Cada código vale 10 minutos y una sola vez. En tu PC abre Mesa, Teléfono, y genera uno nuevo.",
      form: true,
      error: "Ese código no sirve.",
    });
  }
  const res = new NextResponse(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
  res.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", maxAge: THIRTY_DAYS, path: "/" });
  return res;
}

/**
 * GET /pair?c=<code>: the link inside the QR on /telefono. A valid code (single use, 10 min, stored hashed) sets the
 * mesa_token cookie (httpOnly, Secure, SameSite=Strict, 30 days) and sends the phone to /. The token is never in a
 * URL: the code is, and it is dead after this request. The redirect is relative so it works behind any Host.
 * Without `c` it shows the form where the short code is typed.
 */
export function GET(req: Request) {
  const token = process.env.MESA_TOKEN;
  if (!token) return noToken();
  const code = new URL(req.url).searchParams.get("c");
  if (code === null) {
    return pairPage({ status: 200, title: "Vincula este teléfono", text: "Escribe el código de 8 caracteres que aparece en Mesa, Teléfono, en tu PC.", form: true });
  }
  return redeem(code, token);
}

/**
 * POST /pair (form field `code`): the same redemption with the short code typed by hand, for an installed app whose
 * cookie jar is not Safari's. 5 wrong tries in 10 minutes answer 429 (src/lib/repo/pairing.ts).
 */
export async function POST(req: Request) {
  const token = process.env.MESA_TOKEN;
  if (!token) return noToken();
  let code = "";
  try {
    const v = (await req.formData()).get("code");
    code = typeof v === "string" ? v : "";
  } catch {
    code = "";
  }
  return redeem(code, token);
}
