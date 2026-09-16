-- Comment-to-DM schema. Run in the Supabase SQL editor or with `supabase db push`.

create extension if not exists "pgcrypto";

create table if not exists ig_accounts (
  ig_user_id        text primary key,
  username          text not null,
  access_token      text not null,
  token_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists automations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  ig_user_id       text not null references ig_accounts (ig_user_id) on delete cascade,
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

create index if not exists automations_account_idx on automations (ig_user_id, active);

create table if not exists activity (
  id             uuid primary key default gen_random_uuid(),
  comment_id     text not null,
  ig_user_id     text not null,
  automation_id  uuid references automations (id) on delete set null,
  from_username  text not null default '',
  comment_text   text not null default '',
  status         text not null check (status in ('sent', 'skipped', 'failed')),
  detail         text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists activity_comment_idx on activity (comment_id);
create index if not exists activity_created_idx on activity (created_at desc);

-- The app talks to these tables with the service-role key, so lock them down for everyone else.
alter table ig_accounts enable row level security;
alter table automations enable row level security;
alter table activity    enable row level security;
