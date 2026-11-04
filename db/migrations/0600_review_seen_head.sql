-- The newest PR head Mesa has seen for a review whose ticket was closed: the GitHub poll (and the sandbox
-- push) records it when a push reopens the ticket, so one head reopens at most once. head_sha stays the
-- reviewed head (only `review open` moves it); seen_head is where an incremental re-review ends.
ALTER TABLE reviews ADD COLUMN seen_head TEXT NOT NULL DEFAULT '';
