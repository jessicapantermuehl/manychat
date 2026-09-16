-- Option to deliver the resource by email (via a GHL workflow) instead of a link in the DM.
alter table cs_automations
  add column if not exists deliver_by_email_only boolean not null default false,
  add column if not exists email_sent_text       text not null default '';
