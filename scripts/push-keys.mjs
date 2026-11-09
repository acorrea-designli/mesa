#!/usr/bin/env node
// Prints a fresh VAPID key pair for Web Push (phone notifications with the app closed). It writes nothing: paste the
// three lines into .env.local (gitignored) and restart Mesa. Keep the private key out of the repo and out of chats.
// Re-generating invalidates every phone subscription (each phone subscribes again from /telefono).
//   pnpm push:keys [mailto:you@example.com]
import { generateVAPIDKeys } from "web-push";

const subject = process.argv[2] ?? "mailto:you@example.com";
if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) {
  console.error("The subject must be mailto:<email> or an https:// URL.");
  process.exit(2);
}
const { publicKey, privateKey } = generateVAPIDKeys();
console.log(`MESA_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`MESA_VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`MESA_VAPID_SUBJECT=${subject}`);
