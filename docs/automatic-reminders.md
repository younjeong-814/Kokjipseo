# 운영 소비 권장일 알림

로컬 `send-test-email.mjs` 실행 성공은 운영 자동 발송의 증거가 아니다. 운영에서는
`email-reminder-worker`와 DB Cron이 실행되어야 한다.

## 운영 구성

- `202611130001_gmail_reminder_attempts.sql`을 먼저 적용한다.
- worker는 Resend 설정이 있으면 Resend, 없으면 기존 Gmail SMTP 설정을 사용한다.
- Gmail은 `GMAIL_USER`, `GMAIL_APP_PASSWORD`, 선택적인 `GMAIL_SENDER_EMAIL`이 필요하다.
- `EMAIL_CRON_SECRET`은 서버 전용이며 Vault의 `email_cron_secret`과 동일해야 한다.
  값은 SQL 문서·Git·브라우저 코드·로그에 저장하지 않는다.
- Vault `email_worker_url`은 운영 worker URL이다. `supabase/setup/email-cron.sql`로
  10분마다 실행한다. gateway JWT 대신 worker 내부의 cron secret 검사로 인증한다.
- `EMAIL_DISPATCH_ENABLED=true`일 때만 실제 발송한다. 즉시 중단하려면 false로 바꾼다.

## 발송 조건

인증된 주소와 유효한 동의가 있고 알림이 켜진 계정만 대상으로 한다. 서버 식재료의
소비 권장일 D-3, D-1, 당일 오전 9시(KST)부터 검사한다. 해당 날짜가 지난 알림은
소급 발송하지 않는다. 삭제·소비 완료·날짜 변경·수신 철회를 발송 직전에 재확인한다.
한 계정의 해당 재료는 한 통으로 묶는다.

## 실제 운영 테스트

Dashboard의 worker Test에서 POST 본문으로 다음 형식을 사용한다.
`requestId`는 새 테스트 한 번에 UUID 하나를 만들고, 불확실한 결과를 확인할 때는
같은 UUID를 유지한다. 일반 사용자 세션은 이 경로를 호출할 권한이 없다.

```json
{"action":"test","to":"본인의 인증된 알림 주소","requestId":"테스트별 UUID"}
```

`x-cron-secret` 헤더로 전용 비밀키를 전달한다. 서버 관리자는 service-role 키를
Authorization Bearer 또는 `x-reminder-admin` 헤더로 전달할 수도 있다.
Dashboard 프록시가 Authorization을 대체하면 전용 헤더를 사용한다.
테스트는 D-3·D-1·당일 표기가 있는 가상 재료 세 개를 한 통으로 보내며, 전체 자동
발송 설정이나 실제 재료의 발송 기록을 변경하지 않는다. `accepted:1`은 SMTP 접수
성공을 의미하며 받은편지함 도착은 수신자가 별도로 확인해야 한다.

## 중복 방지와 장애 확인

Gmail SMTP에는 제공자 중복 방지 기능이 없다. 따라서 `email_smtp_attempts`에 digest
키와 본문 지문을 먼저 원자적으로 예약한다. SMTP 접수 완료는 accepted로 기록한다.
같은 키로 성공한 발송을 다시 요청해도 SMTP를 재호출하지 않는다.

예약 후 연결이 끊겨 접수 여부가 불확실하면 reserved 상태로 남기고 자동 재발송하지
않는다. 이 경우 일부 알림이 누락될 수 있으므로 Gmail 보낸메일함과 worker 로그를
확인한 뒤 수동으로 판단해야 한다. reserved 행을 무작정 삭제하거나 새 digest로
재발송하지 않는다. SMTP 시도 전에 DB가 실패하면 메일을 보내지 않는다.

운영 점검은 `cron.job`, `cron.job_run_details`, `net._http_response`의 HTTP 상태,
worker Logs, `email_notification_deliveries`와 `email_smtp_attempts`를 함께 확인한다.
Cron SQL 성공만으로 SMTP 발송 성공을 판단하지 않는다.

## 운영 확인 기록 — 2026-11-13

- 운영 프로젝트 `xmmyrlcmufshwapyvwlb`에 SMTP 기록 migration 및 worker 배포.
- 사용자 승인 후 전용 cron secret, Vault URL, 발송 활성화 설정과 정기 실행 연결.
- 승인된 본인 주소로 D-3·D-1·당일 예시를 담은 테스트 메일 한 통 SMTP 접수 성공.
- 실제 실행 HTTP 200: 계정 두 개에 두 통, 대상 재료 세 개, 실패 0건.
- 17:56 KST Cron 자체 실행 성공 확인. 검증 후 운영 주기를 10분 간격으로 복원.
- 전체 자동 테스트 360개, 빌드, Edge 공유 코드 검사, 빌드 비밀키 검사 통과.
- SMTP 접수와 받은편지함 수신은 구분한다. 받은편지함 도착은 별도 수신 확인 필요.

### 2차 설문 운영 누락 복구

같은 날 운영 DB에서 `ut_second_survey`와 `get_ut_second_survey(uuid,boolean)`이
누락된 것을 확인해 기존 `202611100001_second_survey.sql`을 적용하고 migration
이력을 기록했다. 최근 실제 알림을 받은 승인된 테스트 주소의 계정을 대상으로,
상태 업데이트 후 초대 코드가 반환되는지와 임의 digest는 거절되는지를 트랜잭션
안에서 검증한 뒤 롤백했다. 테스트로 설문 응답 완료나 식재료 상태를 변경하지 않았다.
관련 자동 테스트 25개도 통과했다.

가상 재료를 보내는 `action:test` 메일에는 실제 digest 연결 정보가 없다. 해당 메일로는
2차 설문 진입을 검증할 수 없으며 실제 알림 메일의 링크를 사용해야 한다.
