"use client";
// "+ Tarea": a card on the Claude lane. By default it goes straight to an agent (a linked
// ticket and a ticket.created wake to the lead); "Solo anotar (sin agente)" only notes it.
import { useState } from "react";
import { Sheet, useToast } from "@/components/ui/interactive";
import { tableroApi } from "./api";

export function NewTaskSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [project, setProject] = useState("");
  const [noteOnly, setNoteOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setDetail("");
    setProject("");
    setNoteOnly(false);
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const t = await tableroApi.create({ title: title.trim(), excerpt: detail.trim() || undefined, project: project.trim() || undefined, noteOnly });
      toast({ text: t.ticket ? `«${t.title}» para Claude · ${t.ticket.ref}` : `«${t.title}» anotada en Inbox` });
      reset();
      onClose();
      onCreated();
    } catch (e) {
      toast({ text: e instanceof Error ? `No se pudo crear la tarea: ${e.message}` : "No se pudo crear la tarea" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Nueva tarea">
      <form
        className="tb-new"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="tb-new-title">Qué hay que hacer</label>
        <input id="tb-new-title" className="tb-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Revisar los backups de Freightmate" autoFocus required />
        <label htmlFor="tb-new-detail">
          Detalle <span className="opt">(opcional)</span>
        </label>
        <textarea id="tb-new-detail" className="tb-field" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Contexto, enlaces, lo que ya sabes" />
        <label htmlFor="tb-new-project">
          Proyecto <span className="opt">(opcional)</span>
        </label>
        <input id="tb-new-project" className="tb-field" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Proyecto (scope de engram)" />
        <label className="tb-check-row">
          <span className="tb-pick static">
            <input type="checkbox" checked={noteOnly} onChange={(e) => setNoteOnly(e.target.checked)} />
            <span className="tb-box" aria-hidden="true" />
          </span>
          <span>
            Solo anotar (sin agente)
            <small>{noteOnly ? "Solo la tarjeta en Inbox; nadie la trabaja." : "Claude abre un ticket y el lead le asigna un agente."}</small>
          </span>
        </label>
        <div className="tb-new-acts">
          <button className="btn p" type="submit" disabled={busy || !title.trim()}>
            {noteOnly ? "Anotar tarea" : "Crear y dárselo a Claude"}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Sheet>
  );
}
