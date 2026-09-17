-- Story reply / story mention / keyword DM triggers, plus an optional follow gate.

alter table cs_automations
  add column if not exists triggers       text[] not null default '{comment}',
  add column if not exists require_follow boolean not null default false,
  add column if not exists follow_prompt  text not null default '';

alter table cs_conversations drop constraint if exists cs_conversations_state_check;
alter table cs_conversations add constraint cs_conversations_state_check
  check (state in ('awaiting_optin', 'awaiting_follow', 'awaiting_email', 'done', 'abandoned'));
