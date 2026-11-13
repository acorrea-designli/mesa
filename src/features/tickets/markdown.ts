// The small Markdown a checklist step's detail and a thread message may use (t124, t150), parsed to plain data so it is
// tested without a browser and rendered as React elements only (no HTML is ever injected): paragraphs, "- " / "1. "
// lists, fenced code blocks and, inside text, `inline code`, **bold** and [text](url). A link keeps its address only
// when it is an explicit http(s) one (links.ts decides); anything else stays text, as does any HTML.
import { normalizeUrl } from "@/lib/domain/links";

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  /** kids: the bold text parsed again; set only when it holds a link (otherwise v is the whole content). */
  | { t: "bold"; v: string; kids?: Inline[] }
  | { t: "link"; v: string; href: string };
export type Block =
  | { t: "p"; inline: Inline[] }
  | { t: "ul"; items: Inline[][] }
  /** start: the number the list opens at, so a list split by a fence or a paragraph keeps counting. */
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "code"; v: string; lang: string };

// [text](url): the text has no brackets; the address has no spaces and may hold one level of (parens).
const LINK_SRC = String.raw`\[[^\]\n]+\]\((?:[^\s()]|\([^\s()]*\))+\)`;
const INLINE = new RegExp("(`[^`\\n]+`|\\*\\*[^*\\n]+\\*\\*|" + LINK_SRC + ")");
const LINK = /^\[([^\]\n]+)\]\((.+)\)$/s;

/** The address of a link: only an explicit http(s) one, normalized; null leaves the whole "[text](url)" as text. */
function safeHref(raw: string): string | null {
  return /^https?:\/\//i.test(raw) ? normalizeUrl(raw) : null;
}

function piece(p: string): Inline {
  if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return { t: "code", v: p.slice(1, -1) };
  if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) {
    const v = p.slice(2, -2);
    const kids = parseInline(v);
    return kids.some((k) => k.t === "link") ? { t: "bold", v, kids } : { t: "bold", v };
  }
  const m = LINK.exec(p);
  const href = m ? safeHref(m[2]!) : null;
  if (m && href && m[1]!.trim()) return { t: "link", v: m[1]!, href };
  return { t: "text", v: p };
}

/** `code`, **bold** and [text](url) spans of one line of text; the rest is text. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  for (const p of s.split(INLINE)) {
    if (p === "") continue;
    const x = piece(p);
    const last = out.at(-1);
    // a "[text](javascript:...)" left as text joins its neighbours
    if (x.t === "text" && last?.t === "text") last.v += x.v;
    else out.push(x);
  }
  return out;
}

const FENCE = /^\s{0,3}```\s*([\w+-]*)\s*$/;
const UL = /^\s{0,3}[-*]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const INDENTED = /^\s+\S/;

/** The blocks of a detail: a fence opens at a "```" line and closes at the next one (or at the end of the text). */
export function parseDetail(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  // The list item the last line belongs to: an indented line right under it continues it.
  let open: { items: Inline[][]; raw: string } | null = null;
  const flush = () => {
    if (para.length) out.push({ t: "p", inline: parseInline(para.join("\n")) });
    para = [];
    open = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      out.push({ t: "code", v: body.join("\n"), lang: fence[1] ?? "" });
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flush();
      const raw = ul ? ul[1]! : ol![2]!;
      const item = parseInline(raw);
      const last = out.at(-1);
      let items: Inline[][];
      if (last && last.t === (ul ? "ul" : "ol")) items = (last as { items: Inline[][] }).items;
      else {
        items = [];
        out.push(ul ? { t: "ul", items } : { t: "ol", items, start: Number(ol![1]) });
      }
      items.push(item);
      open = { items, raw };
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (open && INDENTED.test(line)) {
      const o: { items: Inline[][]; raw: string } = open;
      o.raw += " " + line.trim();
      o.items[o.items.length - 1] = parseInline(o.raw);
      continue;
    }
    open = null;
    para.push(line);
  }
  flush();
  return out;
}
