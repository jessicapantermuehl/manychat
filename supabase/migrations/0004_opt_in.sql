-- Opt-in step before any further DM (Meta messaging window compliance).

alter table cs_automations
  add column if not exists require_opt_in  boolean not null default true,
  add column if not exists opt_in_prompt   text not null default '',
  add column if not exists opt_in_button   text not null default '';

alter table cs_conversations
  add column if not exists last_message_id text;

alter table cs_conversations drop constraint if exists cs_conversations_state_check;
alter table cs_conversations add constraint cs_conversations_state_check
  check (state in ('awaiting_optin', 'awaiting_email', 'done', 'abandoned'));
