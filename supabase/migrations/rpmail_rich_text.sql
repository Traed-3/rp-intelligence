-- RPMail: signatures and templates that keep their formatting (bold, italic, underline, lists, links).
-- `body` stays the plain wording (it is what the pricing rule reads and what older pages show);
-- `html` is the same wording with its formatting, already cleaned by the server, or null when there is none.
alter table public.rpmail_signatures add column if not exists html text;
alter table public.rpmail_templates add column if not exists html text;
