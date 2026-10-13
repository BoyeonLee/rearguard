-- RearGuard 챗봇용 문서 임베딩 테이블 (Gemini gemini-embedding-001, 768차원)
create extension if not exists vector with schema extensions;

create table if not exists public.rearguard_docs (
  id          bigint generated always as identity primary key,
  source      text not null,          -- 원본 파일 (예: index.html, report/checklist.md)
  title       text not null,          -- 섹션 제목
  chunk_index int  not null default 0,
  content     text not null,
  embedding   extensions.vector(768) not null,
  created_at  timestamptz not null default now()
);

create index if not exists rearguard_docs_embedding_idx
  on public.rearguard_docs using hnsw (embedding extensions.vector_cosine_ops);

-- RLS: 정책을 만들지 않으므로 anon/authenticated는 읽기·쓰기 모두 불가.
-- 적재 스크립트와 Edge Function은 service_role(secret) 키로 접근한다.
alter table public.rearguard_docs enable row level security;

create or replace function public.match_rearguard_docs(
  query_embedding extensions.vector(768),
  match_count     int   default 5,
  match_threshold float default 0.5
)
returns table (id bigint, source text, title text, content text, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select d.id, d.source, d.title, d.content,
         1 - (d.embedding <=> query_embedding) as similarity
  from public.rearguard_docs d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.match_rearguard_docs(extensions.vector, int, float) from public, anon, authenticated;
grant  execute on function public.match_rearguard_docs(extensions.vector, int, float) to service_role;
