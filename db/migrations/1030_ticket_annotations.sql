-- PDF review (t125). Andrés opens a PDF attachment of a ticket in a review view and marks it: a highlight over
-- selected text, a pin, a rectangle, an ellipse or an arrow, each with an optional comment; Claude reads them and
-- replies per annotation. Geometry is stored in PDF page units (the page's viewport at scale 1, origin top left,
-- y down), so a mark lines up at any zoom:
--   highlight { rects: [{x,y,w,h}] }   note { x, y }   rect | ellipse { x,y,w,h }   arrow { x1,y1,x2,y2 }
-- `sent_at` is when the annotation went to Claude in a ticket.annotations wake ("Enviar a Claude"); NULL = not sent
-- yet (a new one, or one Andrés edited, reopened or replied to after sending).
CREATE TABLE annotations (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL CHECK (page >= 1),
  kind          TEXT NOT NULL CHECK (kind IN ('highlight','note','rect','ellipse','arrow')),
  geometry      TEXT NOT NULL,                -- JSON, shape depends on kind (above)
  quote         TEXT NOT NULL DEFAULT '',     -- the selected text of a highlight
  body          TEXT NOT NULL DEFAULT '',     -- the comment
  author        TEXT NOT NULL CHECK (author IN ('andres','claude')),
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  sent_at       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX annotations_attachment ON annotations (attachment_id, page);
CREATE INDEX annotations_ticket ON annotations (ticket_id, state);

CREATE TABLE annotation_replies (
  id            TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  author        TEXT NOT NULL CHECK (author IN ('andres','claude')),
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX annotation_replies_annotation ON annotation_replies (annotation_id, created_at);
