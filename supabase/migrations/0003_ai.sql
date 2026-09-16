-- AI features: intent matching, FAQ answers, triage, voice settings.

alter table cs_automations
  add column if not exists intent_description text not null default '',
  add column if not exists ai_faq             text not null default '';

alter table cs_activity
  add column if not exists category         text,
  add column if not exists suggested_reply  text;

create table if not exists cs_settings (
  ig_user_id     text primary key,
  voice_samples  text not null default '',
  brand_notes    text not null default '',
  updated_at     timestamptz not null default now()
);

alter table cs_settings enable row level security;
