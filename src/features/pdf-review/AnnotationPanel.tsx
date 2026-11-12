"use client";
// The comments panel of the review view (t125): one card per mark in reading order, with Andrés's comment, Claude's
// replies, and the actions (reply, edit, resolve, delete). Read only on the phone: no actions, no send.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { KIND_LABEL } from "@/lib/domain/annotations";
import type { Annotation } from "@/lib/domain/types";
import { hm } from "@/features/tickets/bits";
import { IcSend } from "./icons";

interface Props {
  marks: Annotation[];
  order: Map<string, number>;
  selectedId: string | null;
  editingId: string | null;
  readOnly: boolean;
  /** Andrés's open marks Claude has not been sent yet. */
  pending: number;
  sending: boolean;
  onPick: (id: string) => void;
  onEditing: (id: string | null) => void;
  onSave: (id: string, body: string) => Promise<void>;
  onToggle: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
  onReply: (id: string, body: string) => Promise<void>;
  onSend: () => void;
}

export function AnnotationPanel({ marks, order, selectedId, editingId, readOnly, pending, sending, onPick, onEditing, onSave, onToggle, onDelete, onReply, onSend }: Props) {
  const [only, setOnly] = useState<"all" | "open">("all");
  const [replying, setReplying] = useState<string | null>(null);
  const open = marks.filter((m) => m.state === "open").length;
  const shown = only === "open" ? marks.filter((m) => m.state === "open" || m.id === selectedId) : marks;
  const list = useRef<HTMLOListElement>(null);

  // A mark clicked on the page brings its card into view.
  useEffect(() => {
    if (!selectedId) return;
    list.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <aside className="pr-panel" aria-label="Comentarios">
      <div className="pr-phead">
        <h2>
          Comentarios <span>{marks.length}</span>
        </h2>
        <div className="pr-seg" role="group" aria-label="Filtro">
          <button type="button" className="tab" aria-pressed={only === "all"} onClick={() => setOnly("all")}>
            Todas
          </button>
          <button type="button" className="tab" aria-pressed={only === "open"} onClick={() => setOnly("open")}>
            Abiertas <b>{open}</b>
          </button>
        </div>
      </div>
      {readOnly ? null : (
        <div className="pr-send">
          <button type="button" className="btn p" disabled={!pending || sending} onClick={onSend}>
            <IcSend /> Enviar a Claude ({pending})
          </button>
          <small>{pending ? "Claude lee lo nuevo de una vez; no se avisa por cada marca." : marks.length ? "Todo lo abierto ya está con Claude." : "Subraya, comenta o dibuja sobre el PDF."}</small>
        </div>
      )}
      {shown.length ? (
        <ol className="pr-list" ref={list}>
          {shown.map((a) => (
            <Card
              key={a.id}
              a={a}
              n={order.get(a.id) ?? 0}
              selected={selectedId === a.id}
              editing={editingId === a.id}
              replying={replying === a.id}
              readOnly={readOnly}
              onPick={() => onPick(a.id)}
              onEditing={(on) => onEditing(on ? a.id : null)}
              onReplying={(on) => setReplying(on ? a.id : null)}
              onSave={(body) => onSave(a.id, body)}
              onToggle={() => onToggle(a)}
              onDelete={() => onDelete(a)}
              onReply={(body) => onReply(a.id, body)}
            />
          ))}
        </ol>
      ) : (
        <p className="pr-none">{marks.length ? "No hay comentarios abiertos." : "Aún no hay marcas en este PDF."}</p>
      )}
    </aside>
  );
}

interface CardProps {
  a: Annotation;
  n: number;
  selected: boolean;
  editing: boolean;
  replying: boolean;
  readOnly: boolean;
  onPick: () => void;
  onEditing: (on: boolean) => void;
  onReplying: (on: boolean) => void;
  onSave: (body: string) => Promise<void>;
  onToggle: () => void;
  onDelete: () => void;
  onReply: (body: string) => Promise<void>;
}

function Card({ a, n, selected, editing, replying, readOnly, onPick, onEditing, onReplying, onSave, onToggle, onDelete, onReply }: CardProps) {
  const own = a.author === "andres"; // the board is Andrés: only his marks are his to edit or delete
  const claude = a.author === "claude";
  const unsent = own && a.state === "open" && a.sentAt === null;
  return (
    <li className={["pr-card", selected ? "on" : "", a.state === "resolved" ? "done" : "", claude ? "claude" : ""].filter(Boolean).join(" ")} data-id={a.id} aria-current={selected ? "true" : undefined} onClick={onPick}>
      <div className="pr-chead">
        <span className="pr-no" aria-hidden="true">
          {n}
        </span>
        <span className="pr-meta">
          p. {a.page} · {KIND_LABEL[a.kind]}
        </span>
        {claude ? (
          <span className="pr-who">
            <span className="ln src-claude" style={{ width: 14, background: "var(--c)" }} /> Claude
          </span>
        ) : null}
        {a.state === "resolved" ? <span className="pr-tag">Resuelta</span> : unsent && !readOnly ? <span className="pr-tag dashed">Sin enviar</span> : null}
      </div>
      {a.quote ? <blockquote className="pr-quote">{a.quote}</blockquote> : null}
      {editing && !readOnly ? (
        <Compose
          initial={a.body}
          label="Comentario"
          placeholder="Escribe un comentario (opcional)"
          save="Guardar"
          onSubmit={async (b) => {
            await onSave(b);
            onEditing(false);
          }}
          onCancel={() => onEditing(false)}
        />
      ) : a.body ? (
        <p className="pr-says">{a.body}</p>
      ) : (
        <p className="pr-says empty">Sin comentario</p>
      )}
      {a.replies.length ? (
        <ul className="pr-replies">
          {a.replies.map((r) => (
            <li key={r.id} className={r.author === "claude" ? "claude" : ""}>
              <div className="pr-rwho">
                {r.author === "claude" ? <span className="ln src-claude" style={{ width: 14, background: "var(--c)" }} /> : null}
                {r.author === "claude" ? "Claude" : "Tú"}
                <time>{hm(r.createdAt)}</time>
              </div>
              <p>{r.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {replying && !readOnly ? (
        <Compose
          initial=""
          label="Respuesta"
          placeholder="Responde a Claude"
          save="Responder"
          onSubmit={async (b) => {
            await onReply(b);
            onReplying(false);
          }}
          onCancel={() => onReplying(false)}
        />
      ) : null}
      {readOnly || editing || replying ? null : (
        <div className="pr-acts" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn sm" onClick={() => onReplying(true)}>
            Responder
          </button>
          {own ? (
            <button type="button" className="btn sm" onClick={() => onEditing(true)}>
              Editar
            </button>
          ) : null}
          <button type="button" className="btn sm" onClick={onToggle}>
            {a.state === "open" ? "Resolver" : "Reabrir"}
          </button>
          {own ? (
            <button type="button" className="btn sm" onClick={onDelete}>
              Eliminar
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function Compose({ initial, label, placeholder, save, onSubmit, onCancel }: { initial: string; label: string; placeholder: string; save: string; onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = box.current;
    t?.focus();
    t?.setSelectionRange(t.value.length, t.value.length);
  }, []);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } catch {
      setBusy(false); // the view already showed the error; the text stays
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };
  return (
    <div className="pr-compose" onClick={(e) => e.stopPropagation()}>
      <textarea ref={box} value={text} rows={3} aria-label={label} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={key} />
      <div className="pr-acts">
        <button type="button" className="btn p sm" disabled={busy || (save === "Responder" && !text.trim())} onClick={() => void submit()}>
          {save}
        </button>
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
