begin;
create table public.ut_survey_links (
 user_id uuid not null references auth.users(id) on delete cascade,
 stage integer not null check(stage in(1,2)),
 participation_code uuid not null unique default gen_random_uuid(),
 created_at timestamptz not null default now(),
 submitted_at timestamptz,
 primary key(user_id,stage)
);
create table public.ut_survey_events (
 user_id uuid not null references auth.users(id) on delete cascade,
 event_key uuid not null,
 stage integer not null check(stage in(1,2)),
 event_type text not null check(event_type in('shown','clicked')),
 digest_id uuid,
 source text check(source is null or source in('pickply','instagram','community','platform','email')),
 recorded_at timestamptz not null default now(),
 primary key(user_id,event_key),
 foreign key(user_id,stage) references public.ut_survey_links(user_id,stage) on delete cascade
);
create table public.ut_survey_submissions (
 stage integer not null check(stage in(1,2)),
 response_id text not null check(length(response_id) between 1 and 256),
 user_id uuid not null,
 recorded_at timestamptz not null default now(),
 primary key(stage,response_id),
 foreign key(user_id,stage) references public.ut_survey_links(user_id,stage) on delete cascade
);
alter table public.ut_survey_links enable row level security;
alter table public.ut_survey_events enable row level security;
alter table public.ut_survey_submissions enable row level security;
revoke all on public.ut_survey_links,public.ut_survey_events,public.ut_survey_submissions from public,anon,authenticated;
grant all on public.ut_survey_links,public.ut_survey_events,public.ut_survey_submissions to service_role;

create function public.record_ut_survey_event(p_stage integer,p_event_type text,p_event_key uuid,p_digest uuid default null,p_source text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); code uuid; prior public.ut_survey_events;
begin
 if owner_id is null then raise exception 'authentication_required'; end if;
 if p_stage is null or p_stage not in(1,2) or p_event_type is null or p_event_type not in('shown','clicked') or p_event_key is null
  or (p_source is not null and p_source not in('pickply','instagram','community','platform','email')) then raise exception 'invalid_survey_event'; end if;
 if not exists(select 1 from public.ut_participants where user_id=owner_id and status='active') then return null; end if;
 if p_stage=1 then
  if p_digest is not null then raise exception 'invalid_digest'; end if;
  if not exists(select 1 from public.ingredients where user_id=owner_id and coalesce(payload->>'kind','ingredient')<>'food')
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

create function public.complete_ut_survey(p_stage integer,p_code uuid,p_response_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare owner_id uuid; previous_owner uuid;
begin
 if p_stage is null or p_stage not in(1,2) or p_code is null or p_response_id is null or length(p_response_id) not between 1 and 256 then raise exception 'invalid_submission'; end if;
 select l.user_id into owner_id from public.ut_survey_links l join public.ut_participants p on p.user_id=l.user_id
 where l.stage=p_stage and l.participation_code=p_code and p.status='active';
 if owner_id is null then return false; end if;
 insert into public.ut_survey_submissions(stage,response_id,user_id) values(p_stage,p_response_id,owner_id) on conflict(stage,response_id) do nothing;
 select user_id into previous_owner from public.ut_survey_submissions where stage=p_stage and response_id=p_response_id;
 if previous_owner<>owner_id then raise exception 'response_id_conflict'; end if;
 update public.ut_survey_links set submitted_at=coalesce(submitted_at,now()) where user_id=owner_id and stage=p_stage;
 if p_stage=2 then update public.ut_second_survey set completed_at=coalesce(completed_at,now()) where user_id=owner_id; end if;
 return true;
end $$;
revoke all on function public.record_ut_survey_event(integer,text,uuid,uuid,text) from public,anon;
grant execute on function public.record_ut_survey_event(integer,text,uuid,uuid,text) to authenticated;
revoke all on function public.complete_ut_survey(integer,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_ut_survey(integer,uuid,text) to service_role;
commit;
