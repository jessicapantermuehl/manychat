-- Email capture + GoHighLevel sync.

alter table cs_automations
  add column if not exists collect_email     boolean not null default false,
  add column if not exists email_prompt      text not null default '',
  add column if not exists email_retry_text  text not null default '',
  add column if not exists ghl_tags          text[] not null default '{}';

alter table cs_activity drop constraint if exists cs_activity_status_check;
alter table cs_activity drop constraint if exists activity_status_check;
alter table cs_activity add constraint cs_activity_status_check check (status in ('sent', 'skipped', 'failed', 'captured'));

create table if not exists cs_conversations (
  ig_user_id      text not null,
  igsid           text not null,
  username        text not null default '',
  automation_id   uuid references cs_automations (id) on delete set null,
  comment_id      text not null default '',
  state           text not null check (state in ('awaiting_email', 'done', 'abandoned')),
  attempts        integer not null default 1,
  email           text,
  ghl_contact_id  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (ig_user_id, igsid)
);

create index if not exists cs_conversations_state_idx on cs_conversations (state, updated_at desc);

alter table cs_conversations enable row level security;
