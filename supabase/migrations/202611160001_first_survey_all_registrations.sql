-- First survey covers ingredients and prepared food alike; consent and ownership remain required.
begin;
create or replace function public.record_ut_survey_event(p_stage integer,p_event_type text,p_event_key uuid,p_digest uuid default null,p_source text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); code uuid; prior public.ut_survey_events;
begin
 if owner_id is null then raise exception 'authentication_required'; end if;
 if p_stage is null or p_stage not in(1,2) or p_event_type is null or p_event_type not in('shown','clicked') or p_event_key is null
  or (p_source is not null and p_source not in('pickply','instagram','community','platform','email')) then raise exception 'invalid_survey_event'; end if;
 if not exists(select 1 from public.ut_participants where user_id=owner_id and status='active') then return null; end if;
 if p_stage=1 then
  if p_digest is not null then raise exception 'invalid_digest'; end if;
  if not exists(select 1 from public.ingredients where user_id=owner_id)
   and not exists(select 1 from public.ingredient_activities where user_id=owner_id and type='registered') then return null; end if;
  insert into public.ut_survey_links(user_id,stage) values(owner_id,1) on conflict(user_id,stage) do nothing;
 else
  if p_digest is null or not exists(select 1 from public.email_notification_deliveries where user_id=owner_id and digest_id=p_digest and status='sent') then return null; end if;
  select participation_code into code from public.ut_second_survey where user_id=owner_id and completed_at is null;
  if code is null then return null; end if;
  insert into public.ut_survey_links(user_id,stage,participation_code) values(owner_id,2,code) on conflict(user_id,stage) do nothing;
 end if;
 select participation_code into code from public.ut_survey_links where user_id=owner_id and stage=p_stage;
 select * into prior from public.ut_survey_events where user_id=owner_id and event_key=p_event_key;
 if found then
  if prior.stage<>p_stage or prior.event_type<>p_event_type or prior.digest_id is distinct from p_digest then raise exception 'event_key_conflict'; end if;
  return code;
 end if;
 if p_event_type='clicked' and not exists(select 1 from public.ut_survey_events where user_id=owner_id and stage=p_stage and event_type='shown' and digest_id is not distinct from p_digest) then return null; end if;
 if (select count(*) from public.ut_survey_events where user_id=owner_id and recorded_at>=date_trunc('day',now()))>=1000 then return null; end if;
 insert into public.ut_survey_events(user_id,event_key,stage,event_type,digest_id,source)
 values(owner_id,p_event_key,p_stage,p_event_type,p_digest,p_source) on conflict(user_id,event_key) do nothing;
 return code;
end $$;

commit;
