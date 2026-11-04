-- "Pídeme permiso": a message Andrés posts from the ticket asking the agent to file an approval card for the
-- call it is blocked on. kind marks it (NULL for every ordinary message); about_message_id is the latest
-- Claude message at that moment. Mesa only records and wakes the owner; it never touches a settings file.
ALTER TABLE ticket_messages ADD COLUMN kind TEXT;
ALTER TABLE ticket_messages ADD COLUMN about_message_id TEXT;
