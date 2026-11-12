// The small Markdown a checklist step's detail may use (t124), parsed to plain data so it is tested without a browser
// and rendered as React elements only (no HTML is ever injected): paragraphs, "- " / "1. " lists, fenced code blocks
// and, inside text, `inline code` and **bold**. Anything else stays text.

export type Inline = { t: "text"; v: string } | { t: "code"; v: string } | { t: "bold"; v: string };
export type Block =
  | { t: "p"; inline: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "code"; v: string; lang: string };

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;

/** `code` and **bold** spans of one line of text; the rest is text. */
export function parseInline(s: string): Inline[] {
  return s
    .split(INLINE)
    .filter((p) => p !== "")
    .map((p): Inline => {
      if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return { t: "code", v: p.slice(1, -1) };
      if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return { t: "bold", v: p.slice(2, -2) };
      return { t: "text", v: p };
    });
}

const FENCE = /^\s{0,3}```\s*([\w+-]*)\s*$/;
const UL = /^\s{0,3}[-*]\s+(.*)$/;
const OL = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;

/** The blocks of a detail: a fence opens at a "```" line and closes at the next one (or at the end of the text). */
export function parseDetail(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", inline: parseInline(para.join("\n")) });
    para = [];
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
      const kind = ul ? "ul" : "ol";
      const last = out.at(-1);
      const item = parseInline((ul ?? ol)![1]!);
      if (last && last.t === kind) last.items.push(item);
      else out.push({ t: kind, items: [item] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}
