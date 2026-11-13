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

describe("parseInline links", () => {
  it("reads [text](url) with an http(s) address as a link", () => {
    expect(parseInline("mira [be#478](https://github.com/7-Arrow/dre-backend/pull/478) ya")).toEqual([
      { t: "text", v: "mira " },
      { t: "link", v: "be#478", href: "https://github.com/7-Arrow/dre-backend/pull/478" },
      { t: "text", v: " ya" },
    ]);
    expect(parseInline("[wiki](http://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
      { t: "link", v: "wiki", href: "http://en.wikipedia.org/wiki/Foo_(bar)" },
    ]);
  });

  it("leaves any other scheme as literal text", () => {
    for (const bad of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](mailto:a@b.co)", "[x](/relative)", "[x](github.com/a/b)", "[x]( https://a.co)"]) {
      expect(parseInline(bad)).toEqual([{ t: "text", v: bad }]);
    }
    expect(parseInline("antes [x](javascript:void(0)) despues")).toEqual([{ t: "text", v: "antes [x](javascript:void(0)) despues" }]);
  });

  it("leaves [WIP], a bare [x] and an empty text alone", () => {
    expect(parseInline("[WIP] arreglo (parcial)")).toEqual([{ t: "text", v: "[WIP] arreglo (parcial)" }]);
    expect(parseInline("[ ](https://a.co)")).toEqual([{ t: "text", v: "[ ](https://a.co)" }]);
  });

  it("finds a link inside **bold** and inside a list item", () => {
    expect(parseInline("**ver [x](https://a.co/p)**")).toEqual([
      {
        t: "bold",
        v: "ver [x](https://a.co/p)",
        kids: [
          { t: "text", v: "ver " },
          { t: "link", v: "x", href: "https://a.co/p" },
        ],
      },
    ]);
    expect(parseDetail("- uno [x](https://a.co/p)\n- dos")).toEqual([
      {
        t: "ul",
        items: [
          [
            { t: "text", v: "uno " },
            { t: "link", v: "x", href: "https://a.co/p" },
          ],
          [{ t: "text", v: "dos" }],
        ],
      },
    ]);
  });

  it("leaves a bare URL as text for Linked, and keeps Markdown inside code spans as code", () => {
    expect(parseInline("ver https://github.com/o/r/pull/1 hoy")).toEqual([{ t: "text", v: "ver https://github.com/o/r/pull/1 hoy" }]);
    expect(parseInline("`[x](https://a.co)` y `**no**`")).toEqual([
      { t: "code", v: "[x](https://a.co)" },
      { t: "text", v: " y " },
      { t: "code", v: "**no**" },
    ]);
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
      { t: "ol", items: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]], start: 1 },
    ]);
  });

  it("keeps the number a list opens at, so a list split by a fence keeps counting", () => {
    expect(parseDetail("1. uno\n```\ncodigo\n```\n2. dos\n\ntexto\n\n7. siete")).toEqual([
      { t: "ol", items: [[{ t: "text", v: "uno" }]], start: 1 },
      { t: "code", v: "codigo", lang: "" },
      { t: "ol", items: [[{ t: "text", v: "dos" }]], start: 2 },
      { t: "p", inline: [{ t: "text", v: "texto" }] },
      { t: "ol", items: [[{ t: "text", v: "siete" }]], start: 7 },
    ]);
  });

  it("joins an indented line under a list item to that item, trimmed", () => {
    expect(parseDetail("- uno\n    sigue **aqui**\n  y mas\n- dos\n1. a\n   b")).toEqual([
      {
        t: "ul",
        items: [
          [{ t: "text", v: "uno sigue " }, { t: "bold", v: "aqui" }, { t: "text", v: " y mas" }],
          [{ t: "text", v: "dos" }],
        ],
      },
      { t: "ol", items: [[{ t: "text", v: "a b" }]], start: 1 },
    ]);
  });

  it("does not join an indented line after a blank line", () => {
    expect(parseDetail("- uno\n\n  suelta")).toEqual([
      { t: "ul", items: [[{ t: "text", v: "uno" }]] },
      { t: "p", inline: [{ t: "text", v: "  suelta" }] },
    ]);
  });

  it("never produces HTML: a tag in the text stays text", () => {
    expect(parseDetail("<script>alert(1)</script>")).toEqual([{ t: "p", inline: [{ t: "text", v: "<script>alert(1)</script>" }] }]);
  });
});
