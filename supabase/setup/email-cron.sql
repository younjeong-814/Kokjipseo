-- Optional activation ONLY after review. Not part of automatic migrations.
-- Prepare Vault secrets email_worker_url and email_cron_secret using Dashboard.
-- Put the SAME cron value in Edge Function Secrets EMAIL_CRON_SECRET.
-- This contains names only; NEVER paste a real secret into this tracked file.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='email_worker_url')
     or not exists(select 1 from vault.decrypted_secrets where name='email_cron_secret') then
    raise exception 'Configure the two Vault secrets before activating this job';
  end if;
end $$;
select cron.schedule('kokjipseo-email-reminder-plan','*/10 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='email_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='email_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
