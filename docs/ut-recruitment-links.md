# 모집 채널별 테스트 진입 링크

## 공유할 주소

- 인스타그램 광고: `https://younjeong-814.github.io/Kokjipseo/?src=instagram#home`
- 커뮤니티: `https://younjeong-814.github.io/Kokjipseo/?src=community#home`
- 플랫폼: `https://younjeong-814.github.io/Kokjipseo/?src=platform#home`
- 기존 픽플리: `https://younjeong-814.github.io/Kokjipseo/?src=pickply#home`

서비스와 테스트 화면은 같고 유입 경로만 다릅니다. `src`는 사용자 인증이나 계정 ID가 아닙니다. 신규 사용자는 스플래시·가이드 이후 UT 안내로 진행하며, 기존 참여·철회 기록은 덮어쓰지 않습니다. 이메일 재방문은 기존 `source=email`을 우선합니다. 여러 채널 링크를 같은 탭에서 다시 열면 가장 최근 명시한 채널로 바뀌므로 최초 유입 고정 집계와 구분해야 합니다.

## 배포 전 필요 작업

1. `202611120001_ut_recruitment_sources.sql`을 Supabase DB에 적용합니다. 기존 데이터 삭제 없이 허용 유입 경로와 이벤트 기록 함수만 확장합니다.
2. 코드 머지 및 Pages 배포 후 각 링크에서 안내 표시와 동의 후 이벤트 source를 확인합니다.
3. DB 적용과 프런트 배포 전에는 새 채널 집계가 지원된다고 안내하지 않습니다.

동의 전에는 기존 정책에 따라 행동 기록을 수집하지 않습니다.

## 운영 적용 확인 (2026-11-12)

- 작업 브랜치: `feature/yunjeong_ut-recruitment-deploy_v1`.
- 모집 채널 코드는 PR #117로 master에 머지됐으며, 커밋 `d80026b17d7f56f4e090531e51d6d6bd54ba3659`의 [Pages 배포](https://github.com/younjeong-814/Kokjipseo/actions/runs/43220803198)가 성공한 것을 확인했습니다.
- Supabase 프로젝트 `xmmyrlcmufshwapyvwlb`에 `202611120001_ut_recruitment_sources.sql`을 SQL Editor에서 적용했습니다. 이 실행은 수동 SQL 적용이며 Supabase CLI migration history 등록과는 별개입니다.
- `ut_events_source_check`와 `record_ut_event`에 `instagram`, `community`, `platform` 허용 값이 반영됐습니다. 기존 데이터 삭제·초기화 없이 적용했습니다.
- 비인증 `anon` 실행 차단, `authenticated` 실행 허용, `ut_events` RLS 유지 확인.
- 기존 동의 사용자를 기준으로 세 채널의 기록 요청 허용 및 잘못된 채널 거절을 트랜잭션에서 검증했습니다. 전체 롤백하여 테스트 이벤트는 저장하지 않았고 참여 동의 상태는 변경하지 않았습니다.
- 실제 Pages 인스타그램 링크에서 스플래시 자동 전환과 기존 사용자 홈 표시를 확인했습니다. 기존 참여자는 신규 UT 안내를 반복 표시하지 않습니다.

이 확인은 광고 플랫폼 내부 브라우저나 모든 신규 기기의 전체 설문 제출 테스트를 대체하지 않습니다. 이메일 발송·Cron 설정은 이번 적용에서 변경하지 않았습니다.
