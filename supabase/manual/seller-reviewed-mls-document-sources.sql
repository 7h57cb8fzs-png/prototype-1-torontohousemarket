-- Applied through Supabase migration seller_reviewed_mls_document_sources.
-- This source-control copy is documentation; do not rerun blindly.
-- No real property records or client data are included here.
begin;
set local lock_timeout = '5s';
alter table public.seller_subject_archives drop constraint seller_subject_archives_source_url_check;
alter table public.seller_subject_archives add constraint seller_subject_archives_source_url_check check (
  source_url like 'https://%'
  or (
    source_url ~ '^urn:thm:mls-document:file_[a-f0-9]{32}$'
    and coalesce(facts #>> '{_provenance,kind}', '') = 'reviewed_mls'
    and coalesce(facts #>> '{_provenance,listingKey}', '') ~ '^[A-Z][0-9]{7,9}$'
  )
);
comment on column public.seller_subject_archives.source_url is 'Source locator: HTTPS archived MLS source or internal URN for an administrator-reviewed uploaded MLS document. Internal URNs are not public download links.';
commit;
