-- Run only in the named test project after migrations 001, 002, 003.
-- All synthetic users, rows, and usage counters roll back. No external API calls.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
select public.save_fridge_snapshot(0,jsonb_build_object(
  'ingredients',jsonb_build_array(jsonb_build_object('id','20000000-0000-4000-8000-000000000001','name','테스트 양파','category','채소','date','2026-12-01','createdAt','2026-10-24T00:00:00Z','updatedAt','2026-10-24T00:00:00Z')),
  'history','[]'::jsonb,'activities','[]'::jsonb,'recipes',jsonb_build_array(jsonb_build_object('id','test-recipe-a'))));
do $$ begin
  if (public.load_fridge_snapshot()->>'revision')::integer<>1 then raise exception 'revision assertion failed'; end if;
  if jsonb_array_length(public.load_fridge_snapshot()->'ingredients')<>1 then raise exception 'own read failed'; end if;
  begin
    perform public.save_fridge_snapshot(0,'{"ingredients":[],"history":[],"activities":[],"recipes":[]}'::jsonb);
    raise exception 'stale update was accepted';
  exception when others then if sqlerrm <> 'revision_conflict' then raise; end if; end;
  begin
    perform public.save_fridge_snapshot(1,'{"ingredients":[]}'::jsonb);
    raise exception 'invalid snapshot accepted';
  exception when others then if sqlerrm <> 'invalid_snapshot' then raise; end if; end;
  begin
    perform public.save_fridge_snapshot(null,'{"ingredients":[],"history":[],"activities":[],"recipes":[]}'::jsonb);
    raise exception 'null revision accepted';
  exception when others then if sqlerrm <> 'invalid_revision' then raise; end if; end;
  if jsonb_array_length(public.load_fridge_snapshot()->'ingredients')<>1 then raise exception 'failed write changed data'; end if;
  if not public.consume_api_budget('recognize') then raise exception 'first budget failed'; end if;
  perform public.consume_api_budget('recognize') from generate_series(2,20);
  if public.consume_api_budget('recognize') then raise exception 'budget bypass'; end if;
  begin perform count(*) from public.api_usage;raise exception 'usage table exposed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  if jsonb_array_length(public.load_fridge_snapshot()->'ingredients')<>0 or jsonb_array_length(public.load_fridge_snapshot()->'recipes')<>0 then raise exception 'cross-user read'; end if;
  update public.ingredients set name='blocked' where user_id='10000000-0000-4000-8000-000000000001';
  if found then raise exception 'cross-user update'; end if;
  delete from public.ingredients where user_id='10000000-0000-4000-8000-000000000001';
  if found then raise exception 'cross-user delete'; end if;
  if not public.consume_api_budget('recognize') then raise exception 'budget leaked across users'; end if;
  begin
    insert into public.saved_recipes(user_id,id,payload) values('10000000-0000-4000-8000-000000000001','blocked','{"id":"blocked"}');
    raise exception 'cross-user insert';
  exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$ begin
  begin perform public.load_fridge_snapshot();raise exception 'anonymous RPC allowed';exception when insufficient_privilege then null;end;
  begin perform public.consume_api_budget('recognize');raise exception 'anonymous quota allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: owner isolation, stale-write rejection, atomicity, anonymous denial, quota enforcement; synthetic records rolled back' as result;
