-- Retrieval for the assistant: match ANY of the question's words, rank, and return
-- full section text. Runs as the caller, so row-level security still applies.
create or replace function public.assistant_context(q text, n_sections int default 6, n_pages int default 4)
returns table (kind text, ref text, title text, content text, page int, rank real)
language sql stable security invoker set search_path = public as $$
  with query as (
    select nullif(replace(plainto_tsquery('english', q)::text, '&', '|'), '')::tsquery as tsq
  )
  (
    select 'ccr', s.id, s.title, left(s.text, 4000), s.pdf_page, ts_rank_cd(s.fts, query.tsq, 32)
      from ccr_sections s, query
     where query.tsq is not null and s.fts @@ query.tsq
     order by 6 desc
     limit n_sections
  )
  union all
  (
    select 'document', d.id::text, d.title, left(p.content, 2500), p.page, ts_rank_cd(p.fts, query.tsq, 32)
      from document_pages p join documents d on d.id = p.document_id, query
     -- The CC&Rs are already covered section by section above
     where query.tsq is not null and p.fts @@ query.tsq and d.category <> 'governing'
     order by 6 desc
     limit n_pages
  );
$$;
