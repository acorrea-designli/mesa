"use client";
// The question card (t108): one Claude message with 1-6 questions, each with 2-6 options, as a stepper. The step row
// shows every question and its state (abierta, elegida, respondida, retirada) and jumps to it; the body shows one
// question: its options as buttons (the recommended one marked), Claude's recommendation and "Otra respuesta".
// Anterior / Siguiente move between steps, a pick moves to the next open step, and "Enviar respuestas (n de k)" sends
// whatever is picked, from any step. A 1-step card sends on the click. Picks live in the reply draft (Thread).
import { useState } from "react";
import type { QuestionAnswer, TicketQuestion } from "@/lib/domain/types";
import { confirmPick } from "@/lib/motion";
import { Linked } from "./Linkified";
import { hm } from "./bits";
import { answersOf, firstStep, nextOpenStep, pickCount, setPickText, stepState, togglePick, type Picks, type StepState } from "./card";

interface Props {
  /** The questions of one card, in step order. */
  questions: TicketQuestion[];
  picks: Picks;
  onPicks: (p: Picks) => void;
  /** Send these answers now (with whatever else the reply carries). */
  onSend: (answers: QuestionAnswer[]) => void;
  disabled: boolean;
}

const STATE_LABEL: Record<StepState, string> = { open: "abierta", picked: "elegida", answered: "respondida", withdrawn: "retirada" };

export function QuestionCard({ questions, picks, onPicks, onSend, disabled }: Props) {
  const [step, setStep] = useState(() => firstStep(questions, picks));
  const single = questions.length === 1;
  const at = Math.min(step, questions.length - 1);
  const q = questions[at];
  if (!q) return null;
  const { n, k } = pickCount(questions, picks);
  const open = q.state === "open";
  const live = open && !disabled;
  const own = picks[q.id];
  const shown = q.state === "answered" ? q.chosen : own?.chosen;

  const pick = (key: string) => {
    if (single) {
      onSend(answersOf(questions, { [q.id]: { chosen: key, text: own?.text } }));
      return;
    }
    const next = togglePick(picks, q.id, key);
    onPicks(next);
    if (next[q.id]?.chosen) setStep(nextOpenStep(questions, next, at));
  };

  return (
    <div className={single ? "tk-card one" : "tk-card"} role="group" aria-label={single ? "Pregunta" : `${questions.length} preguntas`}>
      {single ? null : (
        <ol className="tk-steps" aria-label="Preguntas">
          {questions.map((x, i) => {
            const st = stepState(x, picks);
            const key = st === "answered" ? x.chosen : st === "picked" ? picks[x.id]?.chosen : null;
            return (
              <li key={x.id}>
                <button
                  type="button"
                  className={`tk-stepb ${st}`}
                  aria-current={i === at ? "step" : undefined}
                  aria-label={`Pregunta ${x.n}: ${STATE_LABEL[st]}${key ? ` ${key}` : ""}`}
                  onClick={() => setStep(i)}
                >
                  <b>{x.n}</b>
                  <small>{key ? `${STATE_LABEL[st]} ${key}` : STATE_LABEL[st]}</small>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className={`tk-step ${q.state}`}>
        {single ? null : (
          <div className="tk-step-k">
            Pregunta {q.n} de {questions.length}
          </div>
        )}
        {q.text ? (
          <p className="tk-q">
            <Linked text={q.text} />
          </p>
        ) : null}
        <div className={live ? "tk-opts" : "tk-opts ro"} role="group" aria-label="Opciones">
          {q.options.map((o) => (
            <button
              key={o.key}
              type="button"
              className={["tk-opt", q.recommended === o.key && "rec", shown === o.key && "pick"].filter(Boolean).join(" ")}
              disabled={!live}
              aria-pressed={shown === o.key}
              onClick={(e) => {
                confirmPick(e.currentTarget);
                pick(o.key);
              }}
            >
              <b>{o.key}</b>
              <span>
                <Linked text={o.label} inButton />
                {o.detail ? (
                  <small>
                    <Linked text={o.detail} inButton />
                  </small>
                ) : null}
                {q.recommended === o.key ? <em className="tk-opt-rec">recomendada</em> : null}
              </span>
            </button>
          ))}
        </div>
        {q.recommended ? (
          <div className="tk-rec">
            <span className="ln src-claude" style={{ background: "var(--c)" }} />
            <span>
              <b>Claude recomienda {q.recommended}:</b> <Linked text={q.recommendation ?? ""} />
            </span>
          </div>
        ) : null}

        {open ? (
          <label className="tk-other">
            <span>Otra respuesta</span>
            <textarea
              rows={1}
              value={own?.text ?? ""}
              disabled={disabled}
              placeholder="Con tus palabras, si ninguna opción sirve"
              onChange={(e) => onPicks(setPickText(picks, q.id, e.target.value))}
            />
          </label>
        ) : q.state === "answered" ? (
          <p className="tk-step-done">
            Respondida {hm(q.answeredAt)}
            {q.answerText ? (
              <>
                {" · "}
                <Linked text={q.answerText} />
              </>
            ) : null}
          </p>
        ) : (
          <p className="tk-step-done">
            Retirada{q.withdrawReason ? (
              <>
                {" · "}
                <Linked text={q.withdrawReason} />
              </>
            ) : null}
          </p>
        )}
      </div>

      {single ? (
        open && own?.text?.trim() ? (
          <div className="tk-card-f">
            <button className="btn sm p" type="button" disabled={disabled} onClick={() => onSend(answersOf(questions, picks))}>
              Enviar respuesta
            </button>
          </div>
        ) : null
      ) : (
        <div className="tk-card-f">
          <button className="btn sm" type="button" disabled={at === 0} onClick={() => setStep(at - 1)}>
            Anterior
          </button>
          <button className="btn sm" type="button" disabled={at >= questions.length - 1} onClick={() => setStep(at + 1)}>
            Siguiente
          </button>
          {k ? (
            <button className="btn sm p" type="button" disabled={disabled || n === 0} onClick={() => onSend(answersOf(questions, picks))}>
              Enviar respuestas ({n} de {k})
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
