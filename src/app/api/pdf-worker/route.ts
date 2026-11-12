import fs from "node:fs/promises";
import path from "node:path";

// The pdf.js worker for the review view (t125), served from the installed pdfjs-dist so it always matches the library.
// Bundling it with `new URL(..., import.meta.url)` makes `next dev` reload the page in a loop (measured on Next 16.4.5),
// and a copy in public/ would be 1 MB of vendored code in git. The URL carries the library version, so it caches for good.
const WORKER = path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");

let cached: Promise<Buffer> | null = null;

/** GET /api/pdf-worker?v=<pdfjs version> -> the worker module */
export async function GET() {
  cached ??= fs.readFile(/*turbopackIgnore: true*/ WORKER);
  const data = await cached.catch(() => null);
  if (!data) {
    cached = null;
    return new Response("pdf.js worker is missing: run pnpm install", { status: 500 });
  }
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
