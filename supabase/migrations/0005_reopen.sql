-- Let a person who tapped "No thanks" by accident get the opt-in question once more.

alter table cs_conversations
  add column if not exists closed_reason text check (closed_reason in ('declined', 'stopped', 'expired', 'no_response', 'error')),
  add column if not exists reopened      boolean not null default false;
