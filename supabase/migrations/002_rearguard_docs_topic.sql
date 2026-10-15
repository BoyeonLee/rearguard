-- 주제(topic) 열 추가: 챗봇이 질문 주제에 해당하는 청크만 검색할 수 있게 한다.
-- 주제 분류 규칙은 scripts/ingest.py의 topic_of()와 같아야 한다.
--   overview : 제품·개요 (홈페이지 기본)
--   model    : 검출 모델·학습·검증·추론 엔진
--   data     : 데이터 전처리·현장 조사
--   hardware : 경고 하드웨어
--   prd      : PRD 문서
-- 기존 match_rearguard_docs는 그대로 두고, 주제 필터를 받는 함수를 새로 추가한다.

alter table public.rearguard_docs add column if not exists topic text;

-- 기존 행 채우기 (임베딩은 그대로 두고 분류만 붙인다)
update public.rearguard_docs set topic = case
  when source = 'PRD/PRD.md' then 'prd'
  when source = 'hardware-diagram.html' or source = 'report/hardware_parts_design.md' then 'hardware'
  when source in ('report/data_preprocessing_design.md', 'report/nuScenes_checklist.md',
                  'report/checklist.md', 'report/checklist_result.md') then 'data'
  when source in ('vision-review.html', 'report/vision_model_review.md',
                  'report/model_training_validation_design.md', 'report/inference_engine_selection.md') then 'model'
  when source = 'index.html' and title ~ '경고 하드웨어|경고 유닛' then 'hardware'
  when source = 'index.html' and title ~ '전처리' then 'data'
  when source = 'index.html' and title ~ 'YOLO26n|검증|성능 목표' then 'model'
  else 'overview'
end
where topic is null;

alter table public.rearguard_docs alter column topic set not null;
alter table public.rearguard_docs add constraint rearguard_docs_topic_check
  check (topic in ('overview', 'model', 'data', 'hardware', 'prd'));

create index if not exists rearguard_docs_topic_idx on public.rearguard_docs (topic);

-- 검색 함수: filter_topics가 null이면 전체, 값이 있으면 그 주제 안에서만 검색
create or replace function public.match_rearguard_docs_by_topic(
  query_embedding extensions.vector(768),
  match_count     int    default 5,
  match_threshold float  default 0.5,
  filter_topics   text[] default null
)
returns table (id bigint, source text, title text, topic text, content text, similarity float)
language sql stable
set search_path = public, extensions
-- 주제 필터 때문에 HNSW 후보가 모자라면 인덱스를 더 훑어 match_count를 채운다 (pgvector 0.8+)
set hnsw.iterative_scan = relaxed_order
as $$
  with hits as materialized (
    select d.id, d.source, d.title, d.topic, d.content,
           d.embedding <=> query_embedding as distance
    from public.rearguard_docs d
    where filter_topics is null or d.topic = any(filter_topics)
    order by d.embedding <=> query_embedding
    limit match_count
  )
  select id, source, title, topic, content, 1 - distance as similarity
  from hits
  where 1 - distance > match_threshold
  order by distance;
$$;

revoke execute on function public.match_rearguard_docs_by_topic(extensions.vector, int, float, text[]) from public, anon, authenticated;
grant  execute on function public.match_rearguard_docs_by_topic(extensions.vector, int, float, text[]) to service_role;
