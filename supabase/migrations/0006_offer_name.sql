-- Name of the resource, available as {{offer}} in every message.
alter table cs_automations add column if not exists offer_name text not null default '';
