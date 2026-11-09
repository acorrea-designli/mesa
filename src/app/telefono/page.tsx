// Teléfono: pairing (QR and short code) and install, per the "Teléfono A + paridad" mock. Pairing only on the PC itself.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { PhoneScreen } from "@/features/phone/PhoneScreen";
import { isLocalRequest } from "@/lib/access";
import { publicUrl } from "@/lib/public-url";

export const metadata: Metadata = { title: "Teléfono" };

export default async function TelefonoPage() {
  const local = isLocalRequest(await headers());
  return <PhoneScreen local={local} publicUrl={local ? publicUrl() : null} />;
}
