-- Claim complete account digests, never split one person's ingredients across the 25-account batch.
alter table public.email_notification_deliveries add column digest_id uuid;
create index email_deliveries_digest_idx on public.email_notification_deliveries(digest_id);
create function public.claim_email_digest_deliveries(p_user_id uuid default null,p_manual boolean default false)
returns setof public.email_notification_deliveries language plpgsql security definer set search_path='' as $$
declare owner uuid; batch uuid; lease uuid;
begin
 perform pg_advisory_xact_lock(73110301);
 for owner in
  select distinct d.user_id from public.email_notification_deliveries d
  where (p_user_id is null or d.user_id=p_user_id)
   and (d.status in ('pending','failed') or (d.status='processing' and d.lease_until<now()))
   and d.attempt_count<3 and d.next_attempt_at<=now()
   and (p_manual or d.scheduled_at<=now()) and public.email_delivery_is_eligible(d,now())
  order by d.user_id limit 25
 loop
  if exists(select 1 from public.email_notification_deliveries d where d.user_id=owner and d.status='processing' and d.lease_until>now()) then continue; end if;
  batch:=null;
  select d.digest_id into batch from public.email_notification_deliveries d
   where d.user_id=owner and d.digest_id is not null and d.status in ('pending','failed','processing')
    and d.attempt_count<3 and d.next_attempt_at<=now()
    and (d.status<>'processing' or d.lease_until<now()) and (p_manual or d.scheduled_at<=now())
    and public.email_delivery_is_eligible(d,now()) order by d.scheduled_at,d.id limit 1;
  if batch is null then
   batch:=gen_random_uuid();
   update public.email_notification_deliveries d set digest_id=batch
    where d.user_id=owner and d.digest_id is null and d.status in ('pending','failed')
     and d.attempt_count<3 and d.next_attempt_at<=now() and (p_manual or d.scheduled_at<=now())
     and public.email_delivery_is_eligible(d,now());
  end if;
  lease:=gen_random_uuid();
  return query update public.email_notification_deliveries d
   set status='processing',attempt_count=d.attempt_count+1,lease_token=lease,lease_until=now()+interval '5 minutes'
   where d.user_id=owner and d.digest_id=batch and d.status in ('pending','failed','processing')
    and (d.status<>'processing' or d.lease_until<now()) and d.attempt_count<3 and d.next_attempt_at<=now()
    and (p_manual or d.scheduled_at<=now()) and public.email_delivery_is_eligible(d,now()) returning d.*;
 end loop;
end;
$$;
create function public.prepare_email_digest(p_digest_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.email_notification_deliveries d where d.digest_id=p_digest_id and d.status='processing' and d.lease_token=p_lease and d.lease_until>now() for update;
 update public.email_notification_deliveries d set status='cancelled',last_error='eligibility_changed'
  where d.digest_id=p_digest_id and d.status='processing' and d.lease_token=p_lease
    and not public.email_delivery_is_eligible(d,now());
 if (select count(distinct user_id) from public.email_notification_deliveries where digest_id=p_digest_id)<>1 then return null; end if;
 select jsonb_build_object('email',s.email,'userId',s.user_id,'ingredients',jsonb_agg(jsonb_build_object(
  'name',i.name,'expiryDate',i.expiry_date,'daysLeft',case d.reminder_type when 'due_today' then 0 when '1_day' then 1 else 3 end,
  'ingredientId',i.id,'deliveryId',d.id) order by i.expiry_date,i.name,d.id)) into result
 from public.email_notification_deliveries d join public.ingredients i on i.id=d.ingredient_id and i.user_id=d.user_id
 join public.email_notification_settings s on s.user_id=d.user_id
 where d.digest_id=p_digest_id and d.status='processing' and d.lease_token=p_lease and d.lease_until>now()
  and public.email_delivery_is_eligible(d,now()) group by s.user_id,s.email;
 return result;
end;
$$;
create function public.finish_email_digest(p_digest_id uuid,p_lease uuid,p_success boolean) returns void
language sql security definer set search_path='' as $$
 update public.email_notification_deliveries d set status=case when p_success then 'sent' else 'failed' end,
 sent_at=case when p_success then now() else null end,last_error=case when p_success then null else 'provider_failed' end,
 next_attempt_at=now()+interval '10 minutes',lease_until=null
 where d.digest_id=p_digest_id and d.status='processing' and d.lease_token=p_lease;
$$;
revoke all on function public.claim_email_digest_deliveries(uuid,boolean),public.prepare_email_digest(uuid,uuid),public.finish_email_digest(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_email_digest_deliveries(uuid,boolean),public.prepare_email_digest(uuid,uuid),public.finish_email_digest(uuid,uuid,boolean) to service_role;
