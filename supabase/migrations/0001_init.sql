-- ConvertlySocial schema. Run in the Supabase SQL editor or with `supabase db push`.

create extension if not exists "pgcrypto";

create table if not exists cs_ig_accounts (
  ig_user_id        text primary key,
  username          text not null,
  access_token      text not null,
  token_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists cs_automations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  ig_user_id       text not null references cs_ig_accounts (ig_user_id) on delete cascade,
  media_id         text,
  keywords         text[] not null default '{}',
  match_mode       text not null default 'contains' check (match_mode in ('contains', 'exact')),
  public_replies   text[] not null default '{}',
  dm_text          text not null,
  dm_link          text,
  dm_button_title  text,
  ignore_replies   boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists cs_automations_account_idx on cs_automations (ig_user_id, active);

create table if not exists cs_activity (
  id             uuid primary key default gen_random_uuid(),
  comment_id     text not null,
  ig_user_id     text not null,
  automation_id  uuid references cs_automations (id) on delete set null,
  from_username  text not null default '',
  comment_text   text not null default '',
  status         text not null check (status in ('sent', 'skipped', 'failed')),
  detail         text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists cs_activity_comment_idx on cs_activity (comment_id);
create index if not exists cs_activity_created_idx on cs_activity (created_at desc);

-- The app talks to these tables with the service-role key, so lock them down for everyone else.
alter table cs_ig_accounts enable row level security;
alter table cs_automations enable row level security;
alter table cs_activity    enable row level security;
