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
