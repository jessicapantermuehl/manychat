-- Default reply for messages nothing else handles (ManyChat's "default reply").

alter table cs_settings
  add column if not exists auto_reply_enabled        boolean not null default false,
  add column if not exists auto_reply_scope          text not null default 'automation' check (auto_reply_scope in ('automation', 'anyone')),
  add column if not exists auto_reply_text           text not null default '',
  add column if not exists auto_reply_buttons        jsonb not null default '[]'::jsonb,
  add column if not exists auto_reply_cooldown_days  integer not null default 7;

create table if not exists cs_auto_replies (
  ig_user_id  text not null,
  igsid       text not null,
  sent_at     timestamptz not null default now(),
  primary key (ig_user_id, igsid)
);

alter table cs_auto_replies enable row level security;
