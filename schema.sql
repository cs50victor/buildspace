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