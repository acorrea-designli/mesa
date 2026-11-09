-- The Project mirror holds draft items only. A task whose gh_item_id points at a content-linked item (a client PR
-- or issue added with item-add, gh_content_url not null) must never edit that item again: forget the item and
-- queue the task as pending, so the next push gives it a fresh draft. Draft-backed tasks (gh_content_url NULL)
-- are left alone.
UPDATE tasks
SET gh_item_id = NULL,
    gh_content_url = NULL,
    sync_state = 'pending',
    sync_error = NULL
WHERE gh_content_url IS NOT NULL;
