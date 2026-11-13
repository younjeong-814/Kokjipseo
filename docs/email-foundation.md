# UT / 소비 권장일 이메일 알림 기반

> 아래는 최초 기반 구현 당시 기록입니다. 2026-11-13 운영 Gmail 및 Cron 연결 작업의 현재 구성은 [운영 소비 권장일 알림](automatic-reminders.md)을 참조하세요.

브랜치: `feature/yunjeong_email-foundation_v1`. 실제 Gmail / Resend 연결 전 준비 단계입니다.

## 현재 동작과 구현 경계

- 기존 Supabase 익명/Google user_id와 식재료·이력·버전 검사 RPC를 유지합니다. 데이터 초기화나 계정 자동 병합은 없습니다.
- 기존 모달 디자인을 사용하지만 임의 번호로 성공하던 테스트 처리는 제거했습니다. 서버가 확인한 인증 결과만 표시합니다.
- 이메일 알림과 UT 행동 수집의 동의는 별개입니다. 동의·철회는 서버 시간과 버전으로 저장합니다.
- 알림 설정은 DB에서 읽고 저장합니다. 실패 시 이전 상태를 유지하며 다시 불러오기를 제공합니다.
- 서버에서 인증코드를 생성하고 사용자/요청별 pepper를 더해 SHA-256 해시만 DB에 저장합니다. 평문 코드는 발송 함수의 메모리에만 존재하며 프런트 응답·로그에 포함되지 않습니다.
- 발송 제공자는 **연결하지 않았습니다**. 현재 request-code는 503과 준비 중 안내를 반환하고 다음 인증 단계로 넘어가지 않습니다. 메일을 보냈다거나 인증을 완료했다고 표시하지 않습니다.
- worker는 기본 planning-only입니다. 발송 예정 행만 생성/취소하고 실제 발송·시도 횟수·sent 상태를 만들지 않습니다. 테스트에서는 주입한 모의 발송기로 흐름을 검증합니다.

## 추가 데이터 (기존 테이블은 보존)

| 테이블 | 역할 |
| --- | --- |
| ut_participants | user_id와 임의 참여 코드, 참여 시작 시각·상태 |
| user_consents | UT / 이메일 알림 각각의 동의·철회·시각·버전 이력 |
| email_notification_settings | 인증된 알림 주소, enabled, 인증·동의 시각과 버전 |
| email_change_requests | 변경할 주소, 코드 해시, 만료·인증·무효화·시도 횟수 |
| email_notification_deliveries | 식재료·기한별 발송 종류, 예정/실제 시각·상태·재시도·오류 코드 |
| ut_events | app_open / notification_click / ingredient_view / ingredient_manage |

인증 요청/해시는 브라우저 조회 금지입니다. 나머지는 본인 행만 SELECT 가능합니다. 인증 성공 표시·발송 결과는 service_role 전용 경로에서만 변경합니다. 일반 사용자는 권한을 제한한 RPC로 본인 동의·알림 설정만 변경합니다.

## 정책

- 소비 권장일(기존 ingredients.expiry_date) 기준 D-3 / D-1 / 당일 오전 9시, Asia/Seoul입니다. UT 참여 시작 + 3일 방식은 사용하지 않습니다.
- 같은 user_id + ingredient_id + expiry_date + reminder_type 조합은 한 행입니다. 이미 sent인 행은 다시 pending으로 만들지 않습니다.
- 오전 9시 이후에 가입/인증하면 당일 해당 알림은 다음 검사 때 한 번 보낼 수 있습니다. 지난 날짜의 알림은 소급 발송하지 않습니다.
- 생성·claim·발송 직전에 현재 식재료 존재, 동일 기한, 남은 양, 인증 주소 revision, 수신 동의를 재확인합니다. 삭제·소비·기한/주소 변경·수신 철회는 미발송 대상을 취소합니다.
- 이메일 변경이 인증되기 전에는 기존 주소와 동의를 그대로 유지합니다. 이메일 인증은 Google 로그인 연결이나 Auth 계정 이메일 변경이 아닙니다.
- 인증번호는 5분, 최대 5회 확인, 재발송 간격 60초, 사용자별 하루(rolling 24h) 10회입니다. 새 요청은 이전 미완료 요청을 무효화합니다.
- 발송 실패는 일반화된 오류 코드만 기록하고 10분 후 재시도하며 최대 3회입니다. 행 잠금·lease로 중복 실행을 방지합니다.
- 향후 발송 제공자는 delivery.id를 기반으로 동일 idempotency key를 지원해야 합니다. 원격 발송과 DB 반영 사이의 장애를 이 키로 중복 방지해야 합니다. 현재 제공자가 없어 실제 발송 재시도는 켜지지 않습니다.

## UT 이벤트 연결

설정에서 참여 동의한 사용자만 저장합니다. 유효한 기존 세션의 user_id를 기준으로 최초 안내 URL과 알림 URL을 연결합니다. 알림 링크는 `/#ingredient-detail?item=식재료UUID&delivery=발송UUID` 형태를 사용할 수 있습니다. 이 ID만으로 계정에 로그인하거나 데이터를 복구하지 않습니다.

브라우저에서는 본인 발송 ID만 기록할 수 있고 DB가 발송 상태 sent와 소유자를 확인합니다. 최초 접속은 페이지 로드별로, 알림 클릭은 해당 페이지 로드 내 발송별로 중복을 제한합니다. 상세 화면을 연 것은 실제 재료의 상태를 물리적으로 확인했다는 증거는 아닙니다.

관리 행동은 기존 식재료 활동 로그가 서버에 저장된 뒤 별도 이벤트로 기록합니다. 기존 이력을 UT 재방문으로 재사용하지 않습니다. 새 이벤트 저장 실패는 기존 CRUD 성공을 되돌리지 않습니다. 네트워크 차단 시 분석 이벤트가 누락될 수 있으며 보장된 감사 로그가 아닙니다.

## 적용 및 배포

1. `pnpm install` 후 `pnpm test`, `pnpm build`, `pnpm edge:check`, `pnpm check:build-secrets`.
2. 검토 후 `supabase/migrations/202610290001_email_foundation.sql` 추가 적용. 기존 테이블 초기화 금지.
3. `node scripts/bundle-edge-functions.mjs email-verification email-reminder-worker`로 이번 함수만 비밀 값 없는 번들 생성 또는 Supabase CLI로 배포. 기존 OCR 생성 코드의 미완성 export 때문에 전체 번들 생성은 별도 확인이 필요하며 이번 작업에서는 기존 OCR 코드를 변경하지 않습니다.
4. 두 함수는 legacy JWT gateway 대신 내부 검사를 사용합니다. 인증 함수는 Auth /user로 실제 JWT를 확인하고, worker는 EMAIL_CRON_SECRET을 확인합니다. 이 검사를 제거하지 않습니다.
5. 후속 실제 메일 연동 시에만 EMAIL_VERIFICATION_PEPPER, EMAIL_CRON_SECRET과 선택한 발송 제공자의 키를 Supabase Secrets에 등록합니다. 실제 값은 채팅·Git·VITE 변수·번들에 넣지 않습니다.
6. 검토 후에만 Vault에 email_worker_url / email_cron_secret을 설정하고 `supabase/setup/email-cron.sql` 실행. 현재 작업은 Cron을 활성화하지 않습니다.
7. 제공자 어댑터를 주입하고 작은 승인된 테스트 대상 발송을 확인한 다음에만 EMAIL_DISPATCH_ENABLED=true로 전환합니다. 현재 index는 null transport이므로 이 값만 켜도 메일이 발송되지 않습니다.

발송 성공은 제공자 요청 수락을 의미하며 받은편지함 도착·열람을 보장하지 않습니다. 반송 웹훅, 탈퇴/삭제·보관 기간, 발송 템플릿과 수신 철회 링크는 실제 발송 연동 시 함께 검토할 후속 항목입니다.

## 검증

개발 전용 PGlite PostgreSQL 엔진에서 실제 마이그레이션을 적용하여 RLS·직접 위조 차단·인증 만료·횟수 제한·동의·예약 중복·취소·lease·3회 제한을 테스트합니다. 별도 메모리 DB이며 실제 사용자 데이터나 실제 메일은 사용하지 않습니다. `pnpm test:notifications`로 실행합니다.

공식 문서: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Secrets](https://supabase.com/docs/guides/functions/secrets), [Cron](https://supabase.com/docs/guides/cron).

## 이번 적용 결과 (2026-10-29)

- 사용자의 적용 승인 후 운영 프로젝트 xmmyrlcmufshwapyvwlb에 추가 migration 적용 완료. 동일 테이블이 없는 것을 먼저 확인했습니다. 이미 적용한 SQL을 다시 실행하지 마세요.
- 운영 테이블 6개 모두 RLS=true, authenticated 직접 INSERT=false. 인증 요청 테이블의 일반 사용자 SELECT도 false임을 메타데이터 쿼리로 확인했습니다.
- email-verification / email-reminder-worker 배포 완료. 사용자 승인 후 legacy gateway JWT 대신 함수 내부 사용자 JWT / 서버 Cron Secret 인증으로 설정했습니다.
- 실제 비인증 호출은 각각 401(임시 계정 연결 확인), 401(unauthorized)로 차단됩니다.
- 실제 로그인 세션으로 localhost:5175 설정 페이지를 열어 DB 읽기를 확인했고, 예약된 테스트 주소 요청은 실제 서버에서 발송 준비 중 안내로 종료됐습니다. 인증코드 화면·인증 완료로 넘어가지 않았으며 실제 메일은 보내지 않았습니다.
- 기존 5174 개발 서버에서는 이전 모듈 캐시 오류가 있어 별도 5175 서버로 검증했습니다.
- 전체 테스트 262개, build, edge:check, check:build-secrets 통과. Edge 공유 파일 비교는 Windows CRLF와 LF를 정규화하도록 보완했습니다.
- 실제 인증 메일, 이메일 변경 완료의 운영 E2E, 발송 제공자 idempotency / 반송, Cron 실행·실발송은 아직 활성화하거나 검증하지 않았습니다. 인증·예약 정책은 별도 PostgreSQL 및 주입한 모의 제공자 테스트로 확인했습니다.
- GitHub Pages 코드 배포·커밋·푸시는 하지 않았습니다. 팀원이 pull한 뒤에는 `pnpm install`이 필요합니다.
