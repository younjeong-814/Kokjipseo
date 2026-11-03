# 알림 메일 테스트 발송

오전 9시를 기다리지 않고, 소비 권장일 알림 메일을 지금 바로 받아 보는 방법입니다. `scripts/send-test-email.mjs`는 DB를 **읽기만** 하고 예약·발송 기록을 남기지 않으며 Cron도 건드리지 않습니다. 운영 9시 발송은 여전히 꺼져 있습니다.

## 1. 처음 한 번 준비

```bash
git pull
pnpm install
cp .env.example .env.local   # 이미 있으면 아래 항목만 추가
```

`.env.local`은 git에 올라가지 않습니다. 아래 값은 **각자 발급**해서 넣고, 채팅·PR·스크린샷에 붙이지 않습니다.

| 항목 | 언제 필요 | 어디서 |
| --- | --- | --- |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | 메일을 보낼 때 | 아래 2 |
| `VITE_SUPABASE_URL` | 내 냉장고 데이터로 보낼 때 | 기존 값 그대로 |
| `SUPABASE_SERVICE_ROLE_KEY` | 내 냉장고 데이터로 보낼 때 | Supabase 대시보드 → Project Settings → API Keys → **secret** 키 |

> `SUPABASE_SERVICE_ROLE_KEY`는 모든 사용자의 데이터를 읽고 쓸 수 있는 키입니다. 프로젝트 멤버가 대시보드에서 직접 복사하고, 메신저로 주고받지 않습니다.

## 2. Gmail 앱 비밀번호 준비

1. 보낼 Google 계정에서 [2단계 인증](https://myaccount.google.com/security)을 켭니다.
2. [앱 비밀번호](https://myaccount.google.com/apppasswords)를 만들고 16자리를 그대로 복사합니다(띄어쓰기 포함 가능).
3. `.env.local`
   ```
   GMAIL_USER=보내는계정@gmail.com
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   ```

## 3. 실행

```bash
# 미리보기만 (발송 없음) → dist-email/reminder-preview.html
pnpm email:test

# 예시 재료(서울우유 1L)로 발송. 남은 일수 3(기본)·1·0
pnpm email:test 받을메일@gmail.com --gmail
pnpm email:test 받을메일@gmail.com 1 --gmail

# 내 냉장고 데이터로 발송 (앱에 Google 로그인한 메일 또는 user_id)
pnpm email:test 받을메일@gmail.com --gmail --from-db --user 앱로그인메일@gmail.com

# 받는 주소를 빼면 대상 재료만 찾고 미리보기만 만든다 (먼저 이걸로 확인 추천)
pnpm email:test --from-db --user 앱로그인메일@gmail.com
```

`--from-db`는 9시 worker와 같은 조건으로 재료를 고릅니다: 소비기한이 **3일 뒤·내일·오늘**이고 남은 양이 0%가 아닌 재료. D-Day·D-1·D-3 대상 재료를 한 통으로 묶어 보냅니다. 대상이 없으면 "보낼 메일이 없어요"가 나오므로, 앱에서 소비기한을 그 날짜로 바꾼 재료를 하나 만들어 두세요.

정상 출력 예:

```
냉장고에서 알림 대상 1개를 찾았어요.
미리보기: dist-email/reminder-preview.html
보냄: [콕집서] ⏰ 소비기한이 1일 남은 식재료가 있어요 (청송사과)
```

## 4. 자주 나는 오류

| 메시지 | 원인 / 해결 |
| --- | --- |
| `Invalid login` | 앱 비밀번호 오타(16자리 확인)·2단계 인증 꺼짐·계정 비밀번호를 넣음 |
| `GMAIL_USER와 GMAIL_APP_PASSWORD를 넣어 주세요` | `.env.local`에 해당 값 없음 |
| `로그인한 계정을 찾지 못했어요` | `--user`가 앱에 Google로 로그인한 메일이 아님. 익명 계정은 user_id로 지정 |
| `Supabase 403: /rest/v1/ingredients` | DB에 service_role 읽기 권한이 없음. Supabase SQL Editor에서 `grant select on public.ingredients to service_role;` 실행 (운영 프로젝트에는 적용됨) |
| 메일이 계속 서울우유 1L | `--from-db`나 `--user`가 빠짐. 출력에 "냉장고에서 알림 대상" 줄이 있는지 확인 |
| 메일이 안 보임 | 스팸함·프로모션 탭 확인 |

## 주의

- **내 계정 데이터로만 테스트**합니다. 다른 사람의 user_id·메일로 `--from-db`를 실행하면 그 사람의 식재료가 메일로 나갑니다.
- 운영 9시 자동 발송(Cron, `EMAIL_DISPATCH_ENABLED`)은 이 테스트와 무관하며 켜지 않습니다. 켜는 절차는 [email-foundation.md](email-foundation.md)의 "적용 및 배포"를 따릅니다.
- Gmail 발송은 로컬 테스트 전용이며 9시 자동 발송과 연결되어 있지 않습니다. 명령어의 `--gmail`은 빼먹지 마세요.
