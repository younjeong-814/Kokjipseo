-- 첫 진입 UT 동의 이후 화면 이동(screen_view)과 유입 경로(source)를 기록한다.
-- 화면 이름·유입 경로만 받으며 이메일 등 개인정보는 받지 않는다. 동의 전에는 기존과 같이 기록하지 않는다.
alter table public.ut_events add column screen text check (screen is null or screen ~ '^[a-z0-9-]{1,40}$');
alter table public.ut_events add column source text check (source is null or source in ('pickply','email'));
alter table public.ut_events drop constraint ut_events_event_type_check;
alter table public.ut_events add constraint ut_events_event_type_check
  check (event_type in ('app_open','notification_click','ingredient_view','ingredient_manage','screen_view'));
alter table public.ut_events add constraint ut_events_screen_view_screen check (event_type<>'screen_view' or screen is not null);

drop function public.record_ut_event(uuid,text,uuid,uuid);
create function public.record_ut_event(p_event_key uuid,p_event_type text,p_ingredient_id uuid default null,p_delivery_id uuid default null,
  p_screen text default null,p_source text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();
begin
  if owner is null then raise exception 'authentication_required'; end if;
  if p_event_type not in ('app_open','notification_click','ingredient_view','ingredient_manage','screen_view') then raise exception 'invalid_event'; end if;
  if not exists(select 1 from public.ut_participants where user_id=owner and status='active') then return false; end if;
  if p_screen is not null and p_screen !~ '^[a-z0-9-]{1,40}$' then return false; end if;
  if p_source is not null and p_source not in ('pickply','email') then return false; end if;
  if p_event_type='screen_view' and p_screen is null then return false; end if;
  if p_delivery_id is not null and not exists(select 1 from public.email_notification_deliveries where id=p_delivery_id and user_id=owner and status='sent') then return false; end if;
  if p_event_type='notification_click' and p_delivery_id is null then return false; end if;
  if p_ingredient_id is not null and not exists(select 1 from public.ingredients where user_id=owner and id=p_ingredient_id)
     and not exists(select 1 from public.ingredient_activities where user_id=owner and item_id=p_ingredient_id) then return false; end if;
  if (select count(*) from public.ut_events where user_id=owner and recorded_at>=date_trunc('day',now()))>=1000 then return false; end if;
  insert into public.ut_events(user_id,event_key,event_type,ingredient_id,delivery_id,screen,source)
    values(owner,p_event_key,p_event_type,p_ingredient_id,p_delivery_id,p_screen,p_source)
    on conflict(user_id,event_key) do nothing;
  return true;
end $$;
revoke all on function public.record_ut_event(uuid,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.record_ut_event(uuid,text,uuid,uuid,text,text) to authenticated;
