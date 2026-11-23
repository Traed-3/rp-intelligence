-- Settings > Users > Invite message: the wording every one-click invite email uses (subject, intro, what's new).
-- NULL = use the built-in standard text (lib/invite-email.ts). Read and written only by the server (service role).
alter table public.companies add column if not exists invite_email jsonb;
comment on column public.companies.invite_email is 'Invite email wording {subject, intro, whatsNew}; NULL = standard text. Set in Settings > Users > Invite message.';
