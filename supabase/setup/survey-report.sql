-- 조회 전용. 모달 표시 요청·클릭과 Google Forms 실제 제출을 별도로 집계한다.
-- QA- 접두사로 명시적으로 표시한 검증 계정만 제외한다. 계정 수는 사람 수와 다르다.
with stages(stage) as (values(1),(2)), eligible as (
 select user_id from public.ut_participants where participation_code not like 'QA-%'
), events as (
 select stage,count(*) filter(where event_type='shown') as exposures,
 count(distinct user_id) filter(where event_type='shown') as exposed_accounts,
 count(*) filter(where event_type='clicked') as clicks,
 count(distinct user_id) filter(where event_type='clicked') as clicked_accounts
 from public.ut_survey_events join eligible using(user_id) group by stage
), submissions as (
 select stage,count(*) as responses,count(distinct user_id) as submitted_accounts
 from public.ut_survey_submissions join eligible using(user_id) group by stage
)
select s.stage as "설문차수",coalesce(e.exposures,0) as "모달노출기록수",
 coalesce(e.exposed_accounts,0) as "모달노출고유계정",
 coalesce(e.clicks,0) as "설문링크클릭기록수",coalesce(e.clicked_accounts,0) as "클릭고유계정",
 coalesce(r.responses,0) as "연결된실제응답수",coalesce(r.submitted_accounts,0) as "제출고유계정"
from stages s left join events e using(stage) left join submissions r using(stage) order by stage;

-- 참여자별/채널별 조회 (이메일 등 직접 식별정보 제외)
select p.participation_code as "참여자코드",l.stage as "설문차수",
 e.event_type as "이벤트",e.source as "기록당시경로",
 e.recorded_at at time zone 'Asia/Seoul' as "기록시각_KST",
 l.submitted_at at time zone 'Asia/Seoul' as "최초제출연결시각_KST"
from public.ut_survey_events e join public.ut_survey_links l using(user_id,stage)
join public.ut_participants p using(user_id)
where p.participation_code not like 'QA-%'
order by e.recorded_at desc;
