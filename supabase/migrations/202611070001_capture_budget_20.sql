-- 영수증 OCR과 사진 인식(냉장고 칸·상품 촬영) 일일 한도를 사용자당 20회로 맞춘다(OCR 10회→20회, 사진 인식 5회→20회).
-- recipes 50회는 그대로 두고 함수 본문과 권한은 202610240003과 같다.
begin;
create or replace function public.consume_api_budget(api_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare owner uuid:=auth.uid(); maximum integer; count_now integer;
begin
  if owner is null then raise exception 'authentication_required'; end if;
  maximum:=case api_kind when 'recipes' then 50 when 'ocr' then 20 when 'recognize' then 20 else 0 end;
  if maximum=0 then raise exception 'invalid_api_kind'; end if;
  insert into public.api_usage(user_id,day,kind,calls)
  values(owner,(now() at time zone 'Asia/Seoul')::date,api_kind,1)
  on conflict(user_id,day,kind) do update set calls=public.api_usage.calls+1 where public.api_usage.calls < maximum
  returning calls into count_now;
  return count_now is not null;
end;
$$;
revoke all on function public.consume_api_budget(text) from public,anon;
grant execute on function public.consume_api_budget(text) to authenticated;
commit;
