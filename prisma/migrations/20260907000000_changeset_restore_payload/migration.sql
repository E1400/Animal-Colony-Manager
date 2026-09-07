-- Records what a revert removed, so the revert can itself be undone.
--
-- Undo is destructive: it deletes the rows a changeset created and reopens the
-- intervals it closed. Without capturing those rows first there is nothing to
-- put back. Only revert changesets carry a payload; it is null everywhere else.
ALTER TABLE "changesets" ADD COLUMN "restore_payload" JSONB;
