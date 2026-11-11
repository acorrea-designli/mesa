-- Question cards (t108). A Claude message can carry 1-6 questions, each with 2-6 options (keys A-F), a recommended
-- key and a one-line why. Each question has its own explicit state: open until Andrés answers it (a pick or his own
-- words) or Claude withdraws it. Nothing else closes it: not a later message, a plan, a note or a reply of his that
-- answers something else. Closing the ticket withdraws its open questions.
CREATE TABLE ticket_questions (
  id                TEXT PRIMARY KEY,
  ticket_id         TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  n                 INTEGER NOT NULL,          -- step in its card, from 1
  text              TEXT NOT NULL DEFAULT '',  -- '' on a 1-step card whose message body is the question
  options           TEXT NOT NULL,             -- JSON [{key,label,detail?}]
  recommended       TEXT,
  recommendation    TEXT,
  state             TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','withdrawn')),
  chosen            TEXT,                      -- the key he picked, NULL when he answered in his own words
  answer_text       TEXT,                      -- his own words ("Otra respuesta")
  answer_message_id TEXT REFERENCES ticket_messages(id) ON DELETE SET NULL,
  answered_at       TEXT,
  withdraw_reason   TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (message_id, n)
);
CREATE INDEX ticket_questions_ticket ON ticket_questions (ticket_id, state);
CREATE INDEX ticket_questions_answer ON ticket_questions (answer_message_id);

-- Back-fill: every message that carries options becomes a 1-question card (text '': its body is the question).
-- Answered, with his pick, when Andrés wrote after it (his first message after it, a "Pídeme permiso" press aside);
-- withdrawn when nobody answered and the ticket is closed (an old question never reopens); open otherwise.
WITH asked AS (
  SELECT m.id, m.ticket_id, m.options, m.recommended, m.recommendation, m.created_at,
         (SELECT r.id FROM ticket_messages r
           WHERE r.ticket_id = m.ticket_id AND r.author = 'andres' AND COALESCE(r.kind, '') <> 'permission_request'
             AND (r.created_at > m.created_at OR (r.created_at = m.created_at AND r.rowid > m.rowid))
           ORDER BY r.created_at, r.rowid LIMIT 1) AS reply_id
    FROM ticket_messages m
   WHERE m.options IS NOT NULL AND json_valid(m.options) AND json_array_length(m.options) > 0
)
INSERT INTO ticket_questions
  (id, ticket_id, message_id, n, text, options, recommended, recommendation, state, chosen, answer_text,
   answer_message_id, answered_at, withdraw_reason, created_at)
SELECT 'tq_' || lower(hex(randomblob(6))), a.ticket_id, a.id, 1, '', a.options, a.recommended, a.recommendation,
       CASE WHEN r.id IS NOT NULL THEN 'answered' WHEN t.status = 'closed' THEN 'withdrawn' ELSE 'open' END,
       r.chosen,
       CASE WHEN r.id IS NOT NULL AND r.chosen IS NULL THEN r.body END,
       r.id,
       r.created_at,
       CASE WHEN r.id IS NULL AND t.status = 'closed' THEN 'Ticket cerrado sin respuesta' END,
       a.created_at
  FROM asked a
  JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN ticket_messages r ON r.id = a.reply_id;
