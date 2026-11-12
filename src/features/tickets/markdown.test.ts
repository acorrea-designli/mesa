import { describe, expect, it } from "vitest";
import { parseDetail, parseInline } from "./markdown";

describe("parseInline", () => {
  it("splits `code` and **bold** from text, and keeps everything else", () => {
    expect(parseInline("Pega `MESA_ICS_URL` en **.env.local** y reinicia")).toEqual([
      { t: "text", v: "Pega " },
      { t: "code", v: "MESA_ICS_URL" },
      { t: "text", v: " en " },
      { t: "bold", v: ".env.local" },
      { t: "text", v: " y reinicia" },
    ]);
    expect(parseInline("sin nada")).toEqual([{ t: "text", v: "sin nada" }]);
    expect(parseInline("")).toEqual([]);
  });

  it("leaves an unclosed or empty marker as text", () => {
    expect(parseInline("un ` suelto y ** otro")).toEqual([{ t: "text", v: "un ` suelto y ** otro" }]);
    expect(parseInline("``")).toEqual([{ t: "text", v: "``" }]);
  });
});

describe("parseDetail", () => {
  it("makes paragraphs from blank-line separated text, keeping single line breaks", () => {
    expect(parseDetail("uno\ndos\n\ntres")).toEqual([
      { t: "p", inline: [{ t: "text", v: "uno\ndos" }] },
      { t: "p", inline: [{ t: "text", v: "tres" }] },
    ]);
    expect(parseDetail("")).toEqual([]);
    expect(parseDetail("\n\n  \n")).toEqual([]);
  });

  it("reads a fenced block as code, verbatim, with its language; an unclosed fence runs to the end", () => {
    expect(parseDetail("Corre:\n```bash\nnode bin/mesa help\n\n  mesa ticket list\n```\nlisto")).toEqual([
      { t: "p", inline: [{ t: "text", v: "Corre:" }] },
      { t: "code", v: "node bin/mesa help\n\n  mesa ticket list", lang: "bash" },
      { t: "p", inline: [{ t: "text", v: "listo" }] },
    ]);
    expect(parseDetail("```\nsin cierre\nsigue")).toEqual([{ t: "code", v: "sin cierre\nsigue", lang: "" }]);
  });

  it("does not parse Markdown inside a fence", () => {
    expect(parseDetail("```\n**no** `bold` - item\n```")).toEqual([{ t: "code", v: "**no** `bold` - item", lang: "" }]);
  });

  it("groups list lines into one list each, bullets and numbers", () => {
    expect(parseDetail("- uno\n- dos con `x`\n\n1. a\n2) b")).toEqual([
      { t: "ul", items: [[{ t: "text", v: "uno" }], [{ t: "text", v: "dos con " }, { t: "code", v: "x" }]] },
      { t: "ol", items: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]] },
    ]);
  });

  it("never produces HTML: a tag in the text stays text", () => {
    expect(parseDetail("<script>alert(1)</script>")).toEqual([{ t: "p", inline: [{ t: "text", v: "<script>alert(1)</script>" }] }]);
  });
});
