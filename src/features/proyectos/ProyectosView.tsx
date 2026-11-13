"use client";
// Proyectos (t152, variant A "Línea del proyecto"): per client GitHub Project, every open PR on the project's line and
// in a list grouped by board issue, with checks, the GitHub review decision, his Mesa review and the Mesa ticket.
// Read only toward GitHub: the only ways out are links ("Abrir el board en GitHub", a PR, an issue). Everything is
// laid out and formatted on the server (model.ts); this renders it, keeps which folded groups are open, selects a row
// and refreshes when the cache or Mesa changes. Desktop and phone (Teléfono A) are both rendered; CSS shows one.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import { BrokenLine } from "@/components/line/Line";
import { useLiveRefresh } from "@/lib/live/useLive";
import { Band, Corridor } from "./Band";
import { BackIcon, DotIcon, ExtIcon, IssueIcon, PjIcon, RingIcon, TrainIcon } from "./icons";
import type { Block, Cell, Detail, ProjectScreen, Row, Screen, TabLink, Tag } from "./model";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

export function ProyectosView({ screen }: { screen: Screen }) {
  useLiveRefresh({ entityTypes: ["proyectos", "source", "review", "ticket", "item"] });
  const p = screen.project;
  return (
    <div className="pj">
      <div className="pj-desk">
        <header className="pj-head">
          <h1>
            Proyectos{p ? <span>GitHub Project · {p.path}</span> : null}
          </h1>
          {p ? (
            <a className="btn sm" href={p.boardUrl} {...ext}>
              Abrir el board en GitHub <ExtIcon />
            </a>
          ) : null}
        </header>
        <div className="pj-tools">
          <ProjectTabs tabs={screen.tabs} />
          {p ? <Sync p={p} /> : null}
        </div>
        {p ? <Desk p={p} /> : <NoProject error={screen.configError} />}
      </div>
      <div className="pj-phone">{p ? <Phone p={p} tabs={screen.tabs} /> : <NoProject error={screen.configError} />}</div>
    </div>
  );
}

function ProjectTabs({ tabs }: { tabs: TabLink[] }) {
  return (
    <nav className="tabs pj-tabs" aria-label="Proyectos">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cx("tab", t.on && "on")} aria-current={t.on ? "page" : undefined}>
          {t.label} <b>{t.count}</b>
        </Link>
      ))}
    </nav>
  );
}

function Sync({ p }: { p: ProjectScreen }) {
  return (
    <span className={cx("pj-sync", p.sync.limited && "limited")} role="status">
      {p.sync.limited ? <BrokenLine source="github" width={32} title="GitHub en pausa" /> : <PjIcon name="ckok" />}
      <span>
        {p.sync.lead}
        {p.sync.strong ? <b>{p.sync.strong}</b> : null}
        {p.sync.tail}
      </span>
    </span>
  );
}

function NoProject({ error }: { error: string | null }) {
  return (
    <div className="pj-empty">
      <DotIcon size={40} />
      <div>
        <h3>{error ? "No pude leer los proyectos." : "No hay proyectos configurados."}</h3>
        <p>{error ? `config/projects.json: ${error}` : "Agrega uno en config/projects.json: su GitHub Project, el orden de sus estados y sus repos."}</p>
      </div>
    </div>
  );
}

// ---------- desktop ----------

function Desk({ p }: { p: ProjectScreen }) {
  return (
    <>
      {p.notes.length ? <p className="pj-notes">{p.notes.join(" ")}</p> : null}
      <div className="pj-band">
        <Band band={p.band} />
      </div>
      <div className="pj-sel">
        <h2>{p.sel.title}</h2>
        <span>{p.sel.sub}</span>
        {p.sel.tabs.length ? (
          <nav className="tabs" aria-label="Lista">
            {p.sel.tabs.map((t) => (
              <Link key={t.key} href={t.href} scroll={false} className={cx("tab", t.on && "on")} aria-current={t.on ? "page" : undefined}>
                {t.label} <b>{t.count}</b>
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      {p.empty ? (
        <div className="pj-empty">
          <DotIcon size={40} />
          <div>
            <h3>{p.empty.title}</h3>
            <p>{p.empty.text}</p>
            <div className="acts">
              {p.empty.actions.map((a) =>
                a.external ? (
                  <a key={a.href} className="btn sm" href={a.href} {...ext}>
                    {a.label} <ExtIcon />
                  </a>
                ) : (
                  <Link key={a.href} className="btn sm" href={a.href}>
                    {a.label}
                  </Link>
                ),
              )}
            </div>
          </div>
        </div>
      ) : (
        <List p={p} phone={false} />
      )}
    </>
  );
}

function CellView({ c }: { c: Cell }) {
  return (
    <span className={cx("pj-cell", c.strong && "strong")}>
      {c.icon ? <PjIcon name={c.icon} /> : null}
      <span>
        {c.text}
        {c.sub ? <small>{c.sub}</small> : null}
      </span>
    </span>
  );
}

function TagView({ t }: { t: Tag }) {
  return (
    <span className={cx("pj-st", t.kind !== "plain" && t.kind)}>
      {t.icon ? <PjIcon name={t.icon} /> : null}
      {t.text}
    </span>
  );
}

function TicketChip({ r, phone }: { r: Row; phone: boolean }) {
  if (!r.ticket) return phone ? <span className="lk pj-age">{r.ageShort}</span> : <span className="lk pj-none">sin ticket</span>;
  // The phone row is itself a link (to the PR full screen, which links the ticket): no anchor inside an anchor.
  if (phone) return <span className="lk src-claude">{r.ticket.ref}</span>;
  return (
    <>
      <Link className="lk src-claude" href={r.ticket.href} title={r.ticket.title} onClick={(e) => e.stopPropagation()}>
        {r.ticket.ref}
      </Link>
      {r.moreTickets ? <small className="pj-plus">+{r.moreTickets}</small> : null}
    </>
  );
}

function DeskRow({ r }: { r: Row }) {
  const router = useRouter();
  const select = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) return;
    router.replace(r.href, { scroll: false });
  };
  return (
    <div className={cx("pj-grid pj-pr", r.selected && "sel", r.stale && "stale")} onClick={select} data-pr={r.key}>
      <div className="pj-who">
        <div className="subj">
          <b>
            <a href={r.url} {...ext} title={`Abrir #${r.number} en GitHub`}>
              #{r.number} · {r.title}
            </a>
          </b>
          <small>
            {r.stale ? `${r.stale} · ` : ""}
            {r.author} · {r.age}
          </small>
        </div>
      </div>
      <span className="pj-repo">{r.repo}</span>
      <CellView c={r.checks} />
      <CellView c={r.github} />
      <span className="pj-tags">
        {r.tags.length ? r.tags.map((t) => <TagView key={t.text} t={t} />) : <span className="pj-none-t">—</span>}
      </span>
      <span className="pj-tags">
        <TicketChip r={r} phone={false} />
      </span>
    </div>
  );
}

function PhoneRow({ r }: { r: Row }) {
  const tag = r.tags.find((t) => t.kind !== "draft") ?? r.tags[0];
  return (
    <Link href={r.href} scroll={false} className={cx("pj-ph-row", r.selected && "sel")}>
      <div className="subj">
        <b>
          {r.line} #{r.number}
          {r.draft ? <span className="pj-st draft sm">Borrador</span> : null}
        </b>
        <small>{r.title}</small>
      </div>
      <div className="r">
        {tag ? <TagView t={tag.text === "Aprobaste · sin merge" ? { ...tag, text: "Aprobaste" } : tag} /> : null}
        <TicketChip r={r} phone />
      </div>
    </Link>
  );
}

function MoreButton({ onClick, children, flush }: { onClick: () => void; children: ReactNode; flush?: boolean }) {
  return (
    <button type="button" className={cx("pj-more", flush && "flush")} onClick={onClick}>
      {children}
    </button>
  );
}

function BlockView({ b, phone, open, toggle }: { b: Block; phone: boolean; open: boolean; toggle: () => void }) {
  const RowC = phone ? PhoneRow : DeskRow;
  if (b.kind === "train")
    return (
      <div className="pj-train">
        <div className="subj">
          <b>
            <TrainIcon />
            {b.title}
          </b>
          <small>{b.sub}</small>
        </div>
        <div className="pj-tags">
          {b.prs.map((x) => (
            <a key={x.url} className="pj-repo pj-link" href={x.url} {...ext}>
              {x.label}
            </a>
          ))}
          {b.url ? (
            <a className="btn sm" href={b.url} {...ext}>
              Abrir en GitHub <ExtIcon />
            </a>
          ) : null}
        </div>
      </div>
    );
  if (b.kind === "issue") {
    const rows = open ? b.rows : b.rows.slice(0, b.cap);
    return (
      <>
        <div className={phone ? "pj-ph-iss" : "pj-iss"}>
          <span className="ic">{b.interchange ? <RingIcon /> : <IssueIcon />}</span>
          <span className="n">{b.label}</span>
          {b.url ? (
            <a className="t" href={b.url} {...ext}>
              {b.title}
            </a>
          ) : (
            <span className="t">{b.title}</span>
          )}
          {phone ? null : (
            <span className="meta">
              {b.meta}
              <span className={cx("pj-bst", b.statusNone && "none")}>{b.status}</span>
            </span>
          )}
        </div>
        {rows.map((r) => (
          <RowC key={r.key} r={r} />
        ))}
        {!open && b.rows.length > b.cap ? <MoreButton onClick={toggle}>{b.more}</MoreButton> : null}
      </>
    );
  }
  const capped = b.fold ? (open ? b.rows : []) : open || !b.cap ? b.rows : b.rows.slice(0, b.cap);
  const hidden = b.rows.length - capped.length;
  return (
    <>
      <div className={phone ? "pj-ph-iss pj-ph-grp" : "pj-grp"}>
        <span className="gt">{b.title}</span>
        {b.note ? <small>{phone ? `· ${b.note}` : b.note}</small> : null}
        {phone ? null : <span className="rule" />}
      </div>
      {capped.map((r) => (
        <RowC key={r.key} r={r} />
      ))}
      {hidden > 0 ? (
        <MoreButton onClick={toggle} flush={b.fold}>
          {b.more}
        </MoreButton>
      ) : null}
    </>
  );
}

function List({ p, phone }: { p: ProjectScreen; phone: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) => setOpen((s) => new Set(s).add(k));
  const all = open.has("*");
  const blocks = all ? p.blocks : p.blocks.slice(0, p.capBlocks);
  if (!p.blocks.length) return <p className="pj-quiet">Nada abierto aquí.</p>;
  return (
    <div className={phone ? "pj-ph-list" : "pj-list"}>
      {phone ? null : (
        <div className="pj-grid pj-cols" aria-hidden="true">
          <span className="pj-first">Issue y PR</span>
          <span>Repo</span>
          <span>Checks</span>
          <span>Review en GitHub</span>
          <span>Tu review en Mesa</span>
          <span>Ticket</span>
        </div>
      )}
      {blocks.map((b) => (
        <BlockView key={b.key} b={b} phone={phone} open={open.has(b.key)} toggle={() => toggle(b.key)} />
      ))}
      {!all && p.blocks.length > p.capBlocks ? <MoreButton onClick={() => toggle("*")}>{p.moreBlocks}</MoreButton> : null}
    </div>
  );
}

// ---------- phone ----------

/** Scrolls the station strip so the open station's tab is in view (it may be the last of many). */
const showActive = (nav: HTMLElement | null) => {
  const on = nav?.querySelector<HTMLElement>(".tab.on");
  if (nav && on) nav.scrollLeft = Math.max(0, on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
};

function Phone({ p, tabs }: { p: ProjectScreen; tabs: TabLink[] }) {
  if (p.phone.detail) return <PhoneDetail d={p.phone.detail} />;
  return (
    <>
      <header className="pj-ph-top">
        <h1>Proyectos</h1>
        <span className="right">{p.phone.readAgo}</span>
      </header>
      {p.sync.limited ? (
        <div className="pj-ph-sync">
          <Sync p={p} />
        </div>
      ) : null}
      <div className="pj-ph-proj">
        <ProjectTabs tabs={tabs} />
      </div>
      {p.phone.corridor ? (
        <div className="pj-ph-band">
          <Corridor c={p.phone.corridor} />
        </div>
      ) : null}
      {p.phone.stations.length ? (
        <nav className="pj-ph-sts" aria-label="Estaciones" ref={showActive}>
          {p.phone.stations.map((t) => (
            <Link key={t.key} href={t.href} scroll={false} className={cx("tab", t.on && "on")} aria-current={t.on ? "page" : undefined}>
              {t.label} <b>{t.count}</b>
            </Link>
          ))}
        </nav>
      ) : null}
      {p.empty ? (
        <div className="pj-ph-empty">
          <h3>{p.empty.title}</h3>
          <p>{p.empty.text}</p>
          {p.empty.actions.map((a) =>
            a.external ? (
              <a key={a.href} className="btn" href={a.href} {...ext}>
                {a.label} <ExtIcon />
              </a>
            ) : (
              <Link key={a.href} className="btn" href={a.href}>
                {a.label}
              </Link>
            ),
          )}
        </div>
      ) : (
        <List p={p} phone />
      )}
    </>
  );
}

function PhoneDetail({ d }: { d: Detail }) {
  return (
    <div className="pj-ph-detail">
      <header className="pj-ph-top">
        <Link className="back" href={d.back.href} scroll={false}>
          <BackIcon />
          {d.back.label}
        </Link>
        <span className="right">{d.pos}</span>
      </header>
      <div className="pj-ph-body">
        <div className="kind">
          <i aria-hidden="true" />
          {d.kind}
        </div>
        <h2>{d.title}</h2>
        <div className="by">{d.by}</div>
        <div className="k">Estado</div>
        <div className="pj-kv">
          {d.estado.map((e) => (
            <div key={e.title} className="pj-kv-row">
              <span className="ic">
                <PjIcon name={e.icon} />
              </span>
              <div>
                <b>{e.title}</b>
                {e.text ? <span>{e.text}</span> : null}
                {e.quote ? (
                  <div className="pj-quote">
                    {e.quote.at ? <code>{e.quote.at}</code> : null}
                    {e.quote.at ? " · " : null}
                    {e.quote.text}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="k">Issue en el board</div>
        <div className="pj-route">
          {d.issue ? (
            <>
              <div className="row">
                {d.issue.interchange ? <RingIcon /> : <IssueIcon />}
                {d.issue.url ? (
                  <a href={d.issue.url} {...ext}>
                    <b>{d.issue.label}</b>
                  </a>
                ) : (
                  <b>{d.issue.label}</b>
                )}
                <em className={d.issue.statusNone ? "none" : undefined}>{d.issue.status}</em>
              </div>
              {d.issue.siblings ? <div className="row sib">{d.issue.siblings}</div> : null}
            </>
          ) : (
            <div className="row sib">Sin issue en el board</div>
          )}
        </div>
        <div className="k">Ticket en Mesa</div>
        <div className="pj-route">
          {d.tickets.length ? (
            d.tickets.map((t) => (
              <Link key={t.ref} className="row" href={t.href}>
                <span className="lk src-claude">{t.ref}</span>
                <span className="tt">{t.title}</span>
                <em>{t.status}</em>
              </Link>
            ))
          ) : (
            <div className="row sib">Sin ticket</div>
          )}
        </div>
      </div>
      <div className="pj-ph-dock">
        <a className="btn p" href={d.url} {...ext}>
          Abrir en GitHub <ExtIcon />
        </a>
        {d.tickets[0] || d.issue?.url ? (
          <div className="two">
            {d.tickets[0] ? (
              <Link className="btn" href={d.tickets[0].href}>
                Ver ticket {d.tickets[0].ref}
              </Link>
            ) : null}
            {d.issue?.url ? (
              <a className="btn" href={d.issue.url} {...ext}>
                Ver la issue
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
