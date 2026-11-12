// PDF review (t125): a ticket's PDF on one side, the comments panel on the other.
import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { PdfReview } from "@/features/pdf-review/PdfReview";
import { loadReview } from "@/features/pdf-review/read";
import { repos } from "@/lib/repo";
import "@/features/pdf-review/pdf-review.css";

export const metadata: Metadata = { title: "Revisar PDF" };
export const dynamic = "force-dynamic";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function PdfReviewPage({ params }: { params: Promise<{ ref: string; attId: string }> }) {
  const { ref, attId } = await params;
  const r = repos();
  const data = loadReview(r, decodeURIComponent(ref), decodeURIComponent(attId));
  if (!data) notFound();
  // The thread links by ticket id; the address people share is the ref.
  if (decodeURIComponent(ref) !== data.ticket.ref) redirect(`/tickets/${encodeURIComponent(data.ticket.ref)}/pdf/${encodeURIComponent(data.attachment.id)}`);
  return <PdfReview data={data} />;
}
