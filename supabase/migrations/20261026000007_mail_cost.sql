-- Estimated postage cost of letters sent through the mailing service, for the admin mail log.
alter table public.requests add column mail_cost_estimate numeric;
