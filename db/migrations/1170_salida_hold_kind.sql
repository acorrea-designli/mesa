-- t87: why a salida sits in queued_until_back. 'source' = it waits for its source (approved while the source was down, or
-- held because the source was unreachable): the source coming back resumes it. 'lead' = the lead held it with a reason
-- (an upload or a draft failed, a file cannot be sent): nothing resumes it, only Andrés pulls it back to pending.
ALTER TABLE salidas ADD COLUMN hold_kind TEXT CHECK (hold_kind IN ('source','lead'));

-- Salidas already queued: one with a reason was a hold by the lead, one without was approved while the source was down.
UPDATE salidas SET hold_kind = CASE WHEN error IS NOT NULL AND error <> '' THEN 'lead' ELSE 'source' END WHERE status = 'queued_until_back';
