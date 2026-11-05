# 첫 진입 UT 동의와 화면 이동 기록

브랜치: `feature/ut-entry-consent_v1`

- 첫 진입 시 `ut_participants`에 기록이 없으면 홈 위에 동의 바텀시트(`UTConsentSheet`)를 띄운다. [동의하고 시작하기]는 기존 `set_ut_participation(true)`를 호출한다.
- [동의하지 않고 둘러보기]는 이 브라우저에 거절을 기억하고 다시 묻지 않는다. 기록은 남기지 않는다. 동의 철회는 설정의 기존 `UTParticipationControl`에서 한다.
- 메일로 돌아온 방문(`source=email`)과 동의 상태 조회 실패 시에는 시트를 띄우지 않는다.
- 동의 후 화면이 바뀔 때마다 `ut_events`에 `screen_view`(화면 이름)를 남긴다. 모든 이벤트에 첫 진입 경로(`?src=pickply` 또는 `source=email`)를 `source`로 함께 남긴다.
- 서버는 화면 이름 형식(`^[a-z0-9-]{1,40}$`)과 허용된 source만 받는다. 이메일 등 개인정보는 받지 않는다.

## 배포

1. `supabase/migrations/202611050001_ut_screen_views.sql`을 실제 DB에 적용한다. 프런트보다 먼저 적용해야 한다. 순서가 바뀌면 새 파라미터 때문에 기록 RPC가 실패한다. 기록 실패는 앱 동작을 막지 않는다.
2. 픽플리 링크는 `https://<pages 주소>/?src=pickply` 형식으로 쓴다. 해시 앞에 붙여야 한다.

## 확인 쿼리

```sql
select screen, count(distinct user_id) as users
from public.ut_events
where event_type = 'screen_view' and source = 'pickply'
group by screen order by users desc;
```
