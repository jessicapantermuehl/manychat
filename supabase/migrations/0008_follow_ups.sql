-- Extra DMs sent right after the link, inside the open messaging window.
alter table cs_automations add column if not exists follow_up_messages text[] not null default '{}';
