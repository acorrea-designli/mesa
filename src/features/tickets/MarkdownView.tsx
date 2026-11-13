"use client";
// The one renderer of the small Markdown in markdown.ts (t124, t150): the checklist step's detail and the thread's
// messages. React elements only: no dangerouslySetInnerHTML, and the text of every segment goes through Linked
// (bare addresses and known tN refs stay links), so a "[text](url)" is a link and its address is never linked twice.
import { useMemo } from "react";
import { useToast } from "@/components/ui/interactive";
import { srcClass } from "@/components/ui/primitives";
import { classify } from "@/lib/domain/links";
import { Linked } from "./Linkified";
import { parseDetail, parseInline, type Inline } from "./markdown";

type Say = (t: { text: string }) => void;

function copy(text: string, say: Say) {
  const done = () => say({ text: "Copiado" });
  const fail = () => say({ text: "No se pudo copiar: selecciónalo a mano" });
  if (!navigator.clipboard) return fail();
  navigator.clipboard.writeText(text).then(done, fail);
}

/** say: when set, code is copyable (a button per `code`, a "Copiar" per fence); without it code is plain. */
function Spans({ inline, say }: { inline: Inline[]; say?: Say }) {
  return (
    <>
      {inline.map((x, i) =>
        x.t === "code" ? (
          say ? (
            <button key={i} type="button" className="tk-ck-code" title="Copiar" onClick={() => copy(x.v, say)}>
              {x.v}
            </button>
          ) : (
            <code key={i} className="tk-md-code">
              {x.v}
            </code>
          )
        ) : x.t === "bold" ? (
          <b key={i}>{x.kids ? <Spans inline={x.kids} say={say} /> : <Linked text={x.v} />}</b>
        ) : x.t === "link" ? (
          <a key={i} className={["tk-link", srcClass(classify(x.href)?.source)].filter(Boolean).join(" ")} href={x.href} target="_blank" rel="noopener noreferrer" title={x.href}>
            {x.v}
          </a>
        ) : (
          <Linked key={i} text={x.v} />
        ),
      )}
    </>
  );
}

/** One line of Markdown, inline only (no blocks): the folded first line of a message. */
export function MarkdownInline({ text }: { text: string }) {
  const inline = useMemo(() => parseInline(text), [text]);
  return <Spans inline={inline} />;
}

/** The blocks of a text. copyable: code can be copied (the checklist's detail); className goes on the wrapper. */
export function Markdown({ text, className, copyable }: { text: string; className: string; copyable?: boolean }) {
  const toast = useToast();
  const say = copyable ? toast : undefined;
  const blocks = useMemo(() => parseDetail(text), [text]);
  return (
    <div className={className}>
      {blocks.map((b, i) =>
        b.t === "code" ? (
          say ? (
            <div key={i} className="tk-ck-pre">
              <pre tabIndex={0} aria-label={b.lang ? `Código ${b.lang}` : "Código"}>
                <code>{b.v}</code>
              </pre>
              <button type="button" className="btn sm tk-ck-copy" onClick={() => copy(b.v, say)}>
                Copiar
              </button>
            </div>
          ) : (
            <pre key={i} className="tk-md-pre" tabIndex={0} aria-label={b.lang ? `Código ${b.lang}` : "Código"}>
              <code>{b.v}</code>
            </pre>
          )
        ) : b.t === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Spans inline={it} say={say} />
              </li>
            ))}
          </ul>
        ) : b.t === "ol" ? (
          <ol key={i} start={b.start === 1 ? undefined : b.start}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Spans inline={it} say={say} />
              </li>
            ))}
          </ol>
        ) : (
          <p key={i}>
            <Spans inline={b.inline} say={say} />
          </p>
        ),
      )}
    </div>
  );
}
