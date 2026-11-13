"use client";
// The checklist card (t124): one Claude message with 1-30 manual steps. Each row is a real checkbox (keyboard and
// screen reader: it is an <input type="checkbox"> inside its label, a 44 px target on the phone) with the step's text,
// an optional Markdown detail (code copyable) and, when Claude ticked it after checking, "Verificado por Claude" with
// its note. The tap shows its result at once and goes back with a toast when the server refuses (checklist.ts).
// Anyone can untick: a step Claude verified is his to reopen.
import { useRef, useState } from "react";
import type { Checklist, TicketStep } from "@/lib/domain/types";
import { useToast } from "@/components/ui/interactive";
import { IcCheck } from "@/features/salidas/icons";
import { confirmPick } from "@/lib/motion";
import { Linked } from "./Linkified";
import { confirmed, isChecked, percent, rolledBack, shownCount, type Pending } from "./checklist";
import { Markdown } from "./MarkdownView";

interface Props {
  checklist: Checklist;
  /** The ticket is closed: the steps keep their state and cannot be changed. */
  disabled: boolean;
  /** Set one step; rejects with the server's message when it is refused. */
  onSet: (step: TicketStep, done: boolean) => Promise<void>;
}

export function ChecklistCard({ checklist, disabled, onSet }: Props) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending>({});
  const steps = checklist.steps;
  // The server's answer replaces a tap it agrees with (adjusted while rendering, when the steps prop is a new one).
  const [seen, setSeen] = useState(steps);
  if (seen !== steps) {
    setSeen(steps);
    setPending((p) => (Object.keys(p).length ? confirmed(steps, p) : p));
  }

  const { done, total } = shownCount(steps, pending);
  const finished = total > 0 && done === total;

  const set = async (s: TicketStep, want: boolean) => {
    setPending((p) => ({ ...p, [s.id]: want }));
    try {
      await onSet(s, want);
    } catch (e) {
      setPending((p) => rolledBack(p, s.id));
      toast({ text: e instanceof Error ? e.message : "No se pudo marcar el paso" });
    }
  };

  return (
    <div className="tk-card tk-ck-card" role="group" aria-label="Pasos para ti">
      <div className="tk-ck-h">
        <span className="ln src-claude" style={{ width: 14, background: "var(--c)" }} />
        <b>Pasos para ti</b>
        <span className="tk-ck-n" aria-live="polite">
          {finished ? "Todo hecho" : `${done} de ${total} hechos`}
        </span>
      </div>
      <div className="tk-ck-bar" aria-hidden="true">
        <i style={{ width: `${percent(done, total)}%` }} />
      </div>
      <ol className="tk-ck-list">
        {steps.map((s) => (
          <Step key={s.id} s={s} checked={isChecked(s, pending)} disabled={disabled} onSet={(want) => void set(s, want)} />
        ))}
      </ol>
    </div>
  );
}

function Step({ s, checked, disabled, onSet }: { s: TicketStep; checked: boolean; disabled: boolean; onSet: (want: boolean) => void }) {
  const box = useRef<HTMLSpanElement>(null);
  // "Verificado por Claude" only while the server says Claude ticked it (a pending tap of his is his own).
  const verified = s.state === "done" && s.doneBy === "claude" && checked;
  return (
    <li className={["tk-ck", checked && "on", verified && "claude"].filter(Boolean).join(" ")}>
      <label className="tk-ck-l">
        <input
          type="checkbox"
          className="tk-ck-in"
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.checked && box.current) confirmPick(box.current);
            onSet(e.target.checked);
          }}
        />
        <span className="tk-ck-box" ref={box} aria-hidden="true">
          <IcCheck />
        </span>
        <span className="tk-ck-t">
          <span className="tk-ck-k">{s.n}.</span> <Linked text={s.text} />
        </span>
      </label>
      {verified ? (
        <p className="tk-ck-v">
          <span className="ln src-claude" style={{ width: 10, background: "var(--c)" }} />
          <span>
            <b>Verificado por Claude</b>
            {s.note ? (
              <>
                {" · "}
                <Linked text={s.note} />
              </>
            ) : null}
          </span>
        </p>
      ) : null}
      {s.detail ? <Markdown text={s.detail} className="tk-ck-d" copyable /> : null}
    </li>
  );
}
