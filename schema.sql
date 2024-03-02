-- https://supabase.com/blog/openai-embeddings-postgres-vector ❤️

-- one to one with DemoDaySubmission struct
create table demoday_submission (
  id serial primary key,
  title text not null,
  niche text not null,
  description text not null,
  youtube_url text not null,
  youtube_transcript text not null,
  social text not null,
  season text not null,
  embedding vector(1536)
);

-- requests are only going to made on the server at the moment
-- might change later
alter table demoday_submission enable row level security;


-- 
create index on demoday_submission using ivfflat (embedding vector_cosine_ops)
with
  (lists = 500);


-- function
create or replace function match_person (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  title text,
  niche text,
  description text,
  youtube_url text,
  youtube_transcript text,
  social text,
  season text,
  similarity float
)
language sql stable
as $$
  select
    demoday_submission.id,
    demoday_submission.title,
    demoday_submission.niche,
    demoday_submission.description,
    demoday_submission.youtube_url,
    demoday_submission.youtube_transcript,
    demoday_submission.social,
    demoday_submission.season,
    1 - (demoday_submission.embedding <=> query_embedding) as similarity
  from demoday_submission
  where demoday_submission.embedding <=> query_embedding < 1 - match_threshold
  order by demoday_submission.embedding <=> query_embedding
  limit match_count;
$$;
