"use client";
// PDF review (t125): the ticket's PDF on the left (pdf.js, zoom, five tools) and the comments panel on the right.
// Andrés marks the PDF; "Enviar a Claude (n)" sends the marks not sent yet as ONE wake; Claude's replies arrive live.
// On the phone (<= 720px) the view is read only: PDF, marks and replies stacked, no tools, no actions.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { byPosition, isGeneral } from "@/lib/domain/annotations";
import type { Annotation } from "@/lib/domain/types";
import { useToast } from "@/components/ui/interactive";
import { ApiError } from "@/features/salidas/api";
import { IcBack, IcCheck } from "@/features/salidas/icons";
import { fmtSize } from "@/features/tickets/Composer";
import { useLive } from "@/lib/live/useLive";
import { reviewApi } from "./api";
import { AnnotationPanel } from "./AnnotationPanel";
import { IcArrow, IcEllipse, IcHighlight, IcPin, IcRect } from "./icons";
import { clampScale, PdfViewer, type DraftMark, type Tool } from "./PdfViewer";
import type { ReviewData } from "./read";

const TOOLS: { id: Tool; label: string; icon: typeof IcRect }[] = [
  { id: "highlight", label: "Subrayar", icon: IcHighlight },
  { id: "note", label: "Comentar", icon: IcPin },
  { id: "rect", label: "Rectángulo", icon: IcRect },
  { id: "ellipse", label: "Elipse", icon: IcEllipse },
  { id: "arrow", label: "Flecha", icon: IcArrow },
];

const PHONE = "(max-width: 720px)";
const usePhone = () =>
  useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

const sorted = (list: Annotation[]) => [...list].sort(byPosition);
const put = (list: Annotation[], a: Annotation) => sorted([...list.filter((x) => x.id !== a.id), a]);
const say = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Algo salió mal");

/** Where "Volver" goes: Documentos when he came from there, the ticket otherwise. */
export const backTarget = (ticketRef: string, from?: string) =>
  from === "docs" ? { href: "/tickets?tab=docs", label: "Documentos" } : { href: `/tickets?t=${encodeURIComponent(ticketRef)}`, label: ticketRef };

export function PdfReview({ data, from }: { data: ReviewData; from?: string }) {
  const { ticket, attachment } = data;
  const back = backTarget(ticket.ref, from);
  const toast = useToast();
  const phone = usePhone();
  const [marks, setMarks] = useState<Annotation[]>(data.annotations);
  const [tool, setTool] = useState<Tool>("highlight");
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [scale, setScale] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<string | null>(attachment.reviewedAt);
  const [marking, setMarking] = useState(false);
  const seq = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), []);

  // The numbers on the pins and in the cards count the marks on the canvas; a general comment has none.
  const order = useMemo(() => new Map(marks.filter((m) => !isGeneral(m)).map((m, i) => [m.id, i + 1])), [marks]);
  const pending = marks.filter((m) => m.author === "andres" && m.state === "open" && m.sentAt === null).length;

  const refetch = useCallback(() => {
    reviewApi.list(ticket.id, attachment.id).then(setMarks, () => undefined);
  }, [ticket.id, attachment.id]);

  // Claude's replies (and anything else written through the API) refresh the panel. Changes arrive by the ticket's
  // id from the board and by its ref from the CLI.
  useLive(
    (c) => {
      if (c.entityType === "*" || ((c.entityId === ticket.id || c.entityId === ticket.ref) && c.kind.startsWith("annotations"))) refetch();
    },
    { entityTypes: ["ticket"] },
  );

  const fail = useCallback((e: unknown) => toast({ text: say(e) }), [toast]);

  const create = useCallback(
    async (m: DraftMark) => {
      try {
        const a = await reviewApi.create(ticket.id, { attachmentId: attachment.id, ...m });
        setMarks((cur) => put(cur, a));
        setSelectedId(a.id);
        setEditingId(a.id);
      } catch (e) {
        fail(e);
      }
    },
    [ticket.id, attachment.id, fail],
  );

  // A click on a card scrolls to its mark and flashes it; a click on a mark only selects (its card scrolls in).
  const pick = useCallback((id: string) => {
    seq.current += 1;
    setSelectedId(id);
    setFocus({ id, n: seq.current });
    setFlash({ id, n: seq.current });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1500);
  }, []);

  const save = async (id: string, body: string) => {
    try {
      const next = await reviewApi.edit(ticket.id, id, { body });
      setMarks((cur) => put(cur, next));
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const toggle = async (a: Annotation) => {
    try {
      const next = await reviewApi.edit(ticket.id, a.id, { state: a.state === "open" ? "resolved" : "open" });
      setMarks((cur) => put(cur, next));
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (a: Annotation) => {
    try {
      await reviewApi.remove(ticket.id, a.id);
      setMarks((cur) => cur.filter((x) => x.id !== a.id));
      if (selectedId === a.id) setSelectedId(null);
    } catch (e) {
      fail(e);
    }
  };
  const reply = async (id: string, body: string) => {
    try {
      const next = await reviewApi.reply(ticket.id, id, body);
      setMarks((cur) => put(cur, next));
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const send = async () => {
    setSending(true);
    try {
      const r = await reviewApi.send(ticket.id, attachment.id);
      toast({ text: `Enviado a Claude (${r.count})` });
      refetch();
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };

  // A general comment (t147) goes to Claude as soon as it is written: it is created, then the PDF's unsent marks
  // (this one among them) are sent as ONE wake, exactly like "Enviar a Claude (n)". If only the send fails the
  // comment stays saved and unsent (the button still carries it), so the text is not lost.
  const addGeneral = async (page: number, body: string) => {
    let made: Annotation;
    try {
      made = await reviewApi.create(ticket.id, { attachmentId: attachment.id, page, kind: "comment", geometry: {}, body });
    } catch (e) {
      fail(e);
      throw e;
    }
    setMarks((cur) => put(cur, made));
    setSending(true);
    try {
      const r = await reviewApi.send(ticket.id, attachment.id);
      toast({ text: `Enviado a Claude (${r.count})` });
      refetch();
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };

  // "Terminé": he marks the PDF as finished and can press again to undo it. Documentos reads this flag only.
  const toggleReviewed = async () => {
    if (marking) return;
    setMarking(true);
    try {
      const a = await reviewApi.reviewed(ticket.id, attachment.id, reviewedAt === null);
      setReviewedAt(a.reviewedAt);
    } catch (e) {
      fail(e);
    } finally {
      setMarking(false);
    }
  };

  const readOnly = phone;
  const url = `/api/tickets/${encodeURIComponent(ticket.id)}/attachments/${encodeURIComponent(attachment.id)}`;
  const step = (dir: 1 | -1) => setZoom(clampScale(Math.round((scale + dir * 0.25) * 100) / 100));

  return (
    <div className="pr">
      <header className="pr-head">
        <Link className="btn sm" href={back.href} title={`Volver a ${back.label}`}>
          <IcBack /> Volver<span className="pr-back-to">{back.label}</span>
        </Link>
        <h1 title={attachment.filename}>
          {attachment.filename}
          <span>
            {pageCount ? `${pageCount} ${pageCount === 1 ? "página" : "páginas"} · ` : ""}
            {fmtSize(attachment.size)}
          </span>
        </h1>
        {readOnly ? null : (
          <div className="pr-tools" role="toolbar" aria-label="Herramientas">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" className="btn sm pr-tool" aria-pressed={tool === t.id} title={t.label} onClick={() => setTool(t.id)}>
                <t.icon /> <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pr-zoom" role="group" aria-label="Zoom">
          <button type="button" className="btn sm" aria-label="Alejar" onClick={() => step(-1)}>
            −
          </button>
          <button type="button" className="btn sm" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
            Ajustar
          </button>
          <button type="button" className="btn sm" aria-label="Acercar" onClick={() => step(1)}>
            +
          </button>
          <output>{Math.round(scale * 100)}%</output>
        </div>
        <button type="button" className="btn sm pr-done" aria-pressed={reviewedAt !== null} disabled={marking} title={reviewedAt === null ? "Marcar este PDF como revisado" : "Deshacer: volver a pendiente"} onClick={() => void toggleReviewed()}>
          {reviewedAt === null ? null : <IcCheck width={12} height={12} />}
          {reviewedAt === null ? "Terminé" : "Terminado"}
        </button>
        <a className="btn sm" href={url} target="_blank" rel="noreferrer">
          Abrir PDF
        </a>
      </header>
      <div className="pr-body">
        <PdfViewer
          url={url}
          zoom={zoom}
          onScale={setScale}
          tool={tool}
          readOnly={readOnly}
          marks={marks}
          order={order}
          selectedId={selectedId}
          flash={flash}
          focus={focus}
          onSelect={setSelectedId}
          onCreate={create}
          onPages={setPageCount}
        />
        <AnnotationPanel
          marks={marks}
          order={order}
          selectedId={selectedId}
          editingId={editingId}
          readOnly={readOnly}
          pending={pending}
          sending={sending}
          pageCount={pageCount}
          onAddGeneral={addGeneral}
          onPick={pick}
          onEditing={setEditingId}
          onSave={save}
          onToggle={(a) => void toggle(a)}
          onDelete={(a) => void remove(a)}
          onReply={reply}
          onSend={() => void send()}
        />
      </div>
    </div>
  );
}
