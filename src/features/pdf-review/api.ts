// Client calls for the PDF review view (t125). Each returns the fresh Annotation (or throws with the API's English
// message, which the view turns into a toast).
import type { Annotation, AnnotationGeometry, AnnotationKind, AnnotationState } from "@/lib/domain/types";
import { call } from "@/features/salidas/api";

const A = (ticketId: string) => `/api/tickets/${encodeURIComponent(ticketId)}/annotations`;

export interface NewMark {
  attachmentId: string;
  page: number;
  kind: AnnotationKind;
  geometry: AnnotationGeometry;
  quote?: string;
  body?: string;
}

export const reviewApi = {
  list: (ticketId: string, attachmentId: string) => call<Annotation[]>(`${A(ticketId)}?att=${encodeURIComponent(attachmentId)}`),
  create: (ticketId: string, m: NewMark) => call<Annotation>(A(ticketId), { body: m }),
  edit: (ticketId: string, id: string, patch: { body?: string; state?: AnnotationState }) => call<Annotation>(`${A(ticketId)}/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  remove: (ticketId: string, id: string) => call<void>(`${A(ticketId)}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  reply: (ticketId: string, id: string, body: string) => call<Annotation>(`${A(ticketId)}/${encodeURIComponent(id)}/replies`, { body: { body } }),
  /** "Enviar a Claude (n)": one ticket.annotations wake for the marks not sent yet. */
  send: (ticketId: string, attachmentId: string) => call<{ count: number; annotationIds: string[] }>(`${A(ticketId)}/send`, { body: { attachmentId } }),
};
