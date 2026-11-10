create table public.ut_second_survey (
  user_id uuid primary key references auth.users(id) on delete cascade,
  participation_code uuid not null unique default gen_random_uuid(),
  completed_at timestamptz
);
alter table public.ut_second_survey enable row level security;
revoke all on public.ut_second_survey from public, anon, authenticated;

create function public.get_ut_second_survey(p_digest uuid, p_updated boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_sent timestamptz;
  is_followup boolean;
  code uuid;
begin
  if owner_id is null then return null; end if;
  select min(sent_at), bool_or(reminder_type in ('1_day', 'due_today'))
    into current_sent, is_followup
  from public.email_notification_deliveries
  where user_id = owner_id and digest_id = p_digest and status = 'sent';
  if current_sent is null then return null; end if;

  if p_updated is not true and not (is_followup and exists (
    select 1 from public.email_notification_deliveries
    where user_id = owner_id and status = 'sent' and sent_at < current_sent
  )) then return null; end if;

  insert into public.ut_second_survey(user_id) values (owner_id)
  on conflict (user_id) do nothing;
  select participation_code into code from public.ut_second_survey
  where user_id = owner_id and completed_at is null;
  return code;
end;
$$;

create function public.complete_ut_second_survey(p_code uuid)
returns void language sql security definer set search_path = '' as $$
  update public.ut_second_survey set completed_at = now()
  where participation_code = p_code and completed_at is null;
$$;

revoke all on function public.get_ut_second_survey(uuid, boolean) from public, anon;
grant execute on function public.get_ut_second_survey(uuid, boolean) to authenticated;
revoke all on function public.complete_ut_second_survey(uuid) from public, anon, authenticated;
grant execute on function public.complete_ut_second_survey(uuid) to service_role;
