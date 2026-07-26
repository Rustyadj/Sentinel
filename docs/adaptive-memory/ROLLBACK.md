# Rollback

Application rollback: deploy the previous image/commit. The migration is
additive, so the previous application ignores new tables/columns.

Data rollback: use candidate and skill rollback services. They close validity
windows or reactivate prior versions; they do not delete evidence.

Migration rollback should normally be deferred. Dropping adaptive tables would
destroy audit/replay history. If the release must be fully removed, export the
adaptive tables first, stop all writers, drop foreign keys and adaptive tables,
drop added workflow/experience columns, restore the former knowledge-object
unique index only after verifying there are no historical duplicate provenance
rows, then redeploy the prior image.
