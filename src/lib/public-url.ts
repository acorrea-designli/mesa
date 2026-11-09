// The URL the phone opens: MESA_PUBLIC_URL, the hostname the Cloudflare Tunnel publishes (https://mesa.<domain>).
// Nothing in the code depends on which domain it is. https only, origin only (no path, no trailing slash); anything
// else counts as "not set" so a typo cannot put a wrong host in a QR.

export function normalizePublicUrl(raw: string | undefined | null): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const publicUrl = (env: Record<string, string | undefined> = process.env): string | null => normalizePublicUrl(env.MESA_PUBLIC_URL);
