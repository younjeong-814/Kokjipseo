-- Gmail has no provider idempotency key. Reserve BEFORE SMTP and never replay an
-- uncertain send after a timeout/crash. Only a confirmed acceptance can be reused.
create table if not exists public.email_smtp_attempts (
  idempotency_key text primary key,
  fingerprint text not null,
  state text not null default 'reserved' check(state in ('reserved','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.email_smtp_attempts enable row level security;
revoke all on public.email_smtp_attempts from public,anon,authenticated;
grant all on public.email_smtp_attempts to service_role;

create or replace function public.reserve_email_smtp_attempt(p_key text,p_fingerprint text)
returns text language plpgsql security definer set search_path='' as $$
declare previous public.email_smtp_attempts;
begin
  if p_key !~ '^reminder-(digest|test):[0-9a-f-]{36}$' or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_smtp_attempt';
  end if;
  insert into public.email_smtp_attempts(idempotency_key,fingerprint)
    values(p_key,p_fingerprint) on conflict do nothing;
  if found then return 'new'; end if;
  select * into previous from public.email_smtp_attempts where idempotency_key=p_key;
  if previous.fingerprint<>p_fingerprint then return 'conflict'; end if;
  return previous.state;
end;
$$;
create or replace function public.accept_email_smtp_attempt(p_key text,p_fingerprint text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.email_smtp_attempts set state='accepted',accepted_at=now()
    where idempotency_key=p_key and fingerprint=p_fingerprint and state='reserved';
  return found;
end;
$$;
revoke all on function public.reserve_email_smtp_attempt(text,text),public.accept_email_smtp_attempt(text,text) from public,anon,authenticated;
grant execute on function public.reserve_email_smtp_attempt(text,text),public.accept_email_smtp_attempt(text,text) to service_role;
