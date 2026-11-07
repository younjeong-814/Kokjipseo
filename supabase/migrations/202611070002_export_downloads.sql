-- Additive only. 안드로이드 인앱 브라우저(카카오톡·네이버·인스타그램)는 blob 다운로드를 처리하지 못한다.
-- 백업 내용을 5분 동안만 맡겨 두고, 외부 브라우저가 일회용 링크(export-download 함수)로 받아 가게 한다.
begin;

create table public.export_downloads (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (filename ~ '^[A-Za-z0-9._-]{1,100}\.json$'),
  content text not null check (octet_length(content) <= 5000000),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index export_downloads_user_id_idx on public.export_downloads(user_id);
-- 정책 없음: 아래 RPC로만 접근한다.
alter table public.export_downloads enable row level security;

create function public.create_export_download(p_filename text, p_content text) returns text
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); token text;
begin
  if owner is null then raise exception 'authentication_required'; end if;
  perform p_content::jsonb; -- JSON이 아니면 거부한다.
  delete from public.export_downloads where expires_at<now();
  if (select count(*) from public.export_downloads where user_id=owner)>=5 then raise exception 'request_limit'; end if;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.export_downloads(token_hash,user_id,filename,content,expires_at)
    values(encode(sha256(convert_to(token,'UTF8')),'hex'),owner,p_filename,p_content,now()+interval '5 minutes');
  return token;
end $$;

-- 한 번 받으면 바로 지운다. 서버(service role)만 호출할 수 있다.
create function public.take_export_download(p_token text) returns table(filename text, content text)
language sql security definer set search_path='' as $$
  delete from public.export_downloads d
    where d.token_hash=encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex') and d.expires_at>now()
    returning d.filename, d.content;
$$;

revoke all on public.export_downloads from anon, authenticated;
revoke execute on function public.create_export_download(text,text) from public, anon;
grant execute on function public.create_export_download(text,text) to authenticated;
revoke execute on function public.take_export_download(text) from public, anon, authenticated;
grant execute on function public.take_export_download(text) to service_role;

commit;
