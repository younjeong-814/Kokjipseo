# 콕집서 Supabase 연결

- 작업 브랜치: feature/yunjeong_supabase-auth_v1
- 프로젝트: https://xmmyrlcmufshwapyvwlb.supabase.co
- 무료 플랜 유지. 기존 로컬 데이터는 자동 전송하거나 삭제하지 않는다.

## DB

2026-10-24 관리자 SQL Editor에서 생성 완료. pg_class와 pg_policies 조회로 세 테이블의
RLS 활성화 및 authenticated 역할의 auth.uid() = user_id 조건을 확인했다.
가상 계정 두 개를 이용한 DB 권한·저장 충돌·원자성 검증을 실행했고 모두 롤백했다.
실제 Google 로그인은 OAuth 설정 후 별도로 확인해야 한다.

`supabase/migrations/202610240001_ingredient_storage.sql`은 신규 테이블만 생성한다.
이미 존재하는 테이블이면 실패하며 덮어쓰지 않는다. 식재료, 소비·폐기 이력,
관리 활동을 분리하고 기존 앱 자료형을 payload에 보존한다.
세 테이블 모두 RLS를 활성화하고 authenticated 역할에 본인 행만 허용한다.
익명 사용자는 접근할 수 없다. 실사용 전 서로 다른 계정 두 개로 분리 검증이 필요하다.
원자적 저장·버전 충돌 거절은 SQL 테스트로 확인했다. 실제 두 기기의 동기화는 로그인 설정 후 확인한다.

## Google OAuth (사용자 발급·입력 필요)

1. Google Cloud Console에서 사용할 프로젝트를 선택한다.
2. Google Auth Platform에서 앱 정보와 대상 사용자를 설정한다.
3. 테스트 모드라면 테스트 참여 Google 계정을 등록한다.
4. OAuth 클라이언트를 웹 애플리케이션으로 생성한다.
5. 승인된 리디렉션 URI에 아래 주소를 정확히 등록한다.

```
https://xmmyrlcmufshwapyvwlb.supabase.co/auth/v1/callback
```

6. Supabase Authentication → Sign In / Providers → Google에 Client ID와
   Client Secret을 직접 입력하고 활성화·저장한다. nonce 검사 등 기존 보안 설정은 유지한다.
7. Supabase URL Configuration에 배포 사이트와 실제 로컬 개발 주소만 허용한다.

Client Secret은 채팅·Git·VITE_ 환경변수에 넣지 않는다.
OAuth 자격증명은 기존 Vision API 키와 다르다.

## 구현 구조와 현재 상태

- React 19 / TypeScript / Vite / pnpm. 기존 GitHub Pages 정적 배포를 유지한다.
- `src/features/cloud/client.ts`: 공개 URL·publishable key, PKCE Google 로그인.
- `CloudRoot.tsx`: 마이페이지 계정 영역, 계정별 DB 불러오기·저장 재시도·백업·로컬 기록 가져오기.
- `storage.ts`: 기존 동기식 repository를 유지하는 계정별 캐시·미전송 기록 보관.
- `snapshot.ts`: 데이터 검증과 키 매핑. 비로그인 브라우저 기록은 자동 전송하지 않는다.
- `SavedRecipes.tsx`: 레시피 상세 저장/해제, 마이페이지 목록, 저장한 상세 다시 열기.
- `useIngredients.ts`, `useDashboardReports.ts`, `App.tsx`: 직접 localStorage 접근 대신 저장 컨텍스트 사용.
- `externalRequests.ts`: 로그인 JWT와 publishable key를 이용해 Edge Functions 호출.
- 사진 인식은 `showSample()`을 제거하고 실응답만 표시한다. 실패·빈 결과·모의 응답은
  실제 데이터로 등록되지 않으며 재촬영·직접 입력을 안내한다. 사진은 서버 파일로 보관하지 않는다.

공개 설정이 없으면 기존 로컬 모드는 계속 작동한다. 공개 설정을 완료한 환경에서는
외부 API 호출에 Google 로그인이 필요하다. Supabase URL만 넣고 key를 빠뜨리면 빌드를 중단한다.
Edge 함수 배포는 완료했다. Google OAuth와 실제 키 설정 전에는 실서비스 연결 성공으로 간주하지 않는다.

## 단계별 적용과 확인

### 1. DB: 추가 마이그레이션

이 프로젝트는 001을 SQL Editor에서 이미 실행했다. **001을 다시 실행하지 않는다.**
새 프로젝트는 001 → 002 → 003 → 004 순서로 적용한다. 현재 프로젝트에는 네 파일 모두 적용 완료했다.

- `202610240002_cloud_snapshot.sql`: 저장 레시피·버전 테이블과 원자적 snapshot RPC.
- `202610240003_api_budget.sql`: 외부 호출용 사용자별 일일 제한.
- `202610240004_revision_validation.sql`: 누락·음수 버전으로 충돌 검사를 우회하지 못하도록 검증.
- `202611070001_capture_budget_20.sql`: 영수증 OCR(10회→20회)·사진 인식(5회→20회) 일일 한도 상향.
- `supabase/tests/isolation.sql`: 가상 계정 두 개로 소유자 분리·충돌·익명 차단·쿼터 확인 후 전부 롤백.

`save_fridge_snapshot`은 버전이 일치할 때만 자기 데이터에 CRUD를 반영한다.
소비 완료 목록 제거와 소비 이력을 한 트랜잭션으로 저장한다. 버전 충돌 시 자동 병합·덮어쓰기는 중단한다.
화면에서 파일 백업 또는 미전송 캐시 별도 보관 후 서버 다시 불러오기를 제공한다.
서버 다시 불러오기 선택 시 미전송 기록은 `.conflict.<timestamp>` 로컬 키에도 보관한다.
네트워크 응답을 잃은 뒤 충돌이 나면 백업을 확인하고 필요한 항목만 다시 등록한다.

기존 SQL Editor 직접 실행을 CLI 마이그레이션 이력에 자동 등록하지 않았다.
따라서 이력 정리 없이 `db push`로 001부터 일괄 재실행하지 않는다.
기존 데이터 덤프·삭제·초기화 명령은 사용하지 않는다.

### 2. Google 로그인: 사람이 설정

앞의 OAuth 항목에 따라 발급·입력한다. Supabase Authentication → URL Configuration:

- Site URL: `https://younjeong-814.github.io/kokjipseotest/`
- Redirect URLs: 위 주소와 실제 개발용 `http://127.0.0.1:5173/` 등 사용하는 주소만 추가.
- 클라이언트는 `?code=` PKCE 교환으로 인증하므로 기존 `#home` 등 해시 라우팅을 유지한다.
- Google OAuth 리디렉션 URI는 **Supabase `/auth/v1/callback`**이다. GitHub Pages URL과 혼동하지 않는다.
- Google OAuth 테스트 모드라면 외부 테스터의 Google 계정을 테스트 사용자에 등록한다.
- `Skip nonce checks` 및 이메일 확인 비활성화 같은 우회 설정을 사용하지 않는다.

확인: 마이페이지 → Google 로그인 → 복귀 → 본인 냉장고 로드 → 로그아웃 → 다른 계정으로
로그인했을 때 다른 계정 데이터가 나타나지 않는지 확인한다. Google 공급자가 꺼져 있으면
OAuth는 실패한다. 로그인된 사용자 데이터는 원래 익명 저장 키에 기록하지 않는다.

### 3. Edge Functions와 비밀 설정: 사람이 설정

Supabase 프로젝트 → Edge Functions → Secrets에서 다음 **이름**으로 등록한다.
실제 값은 채팅·코드·저장소·GitHub Pages 빌드에 넣지 않는다.

| 이름 | 용도 |
| --- | --- |
| FOOD_SAFETY_API_KEY | 식품안전나라 COOKRCP01 승인된 키 |
| FOOD_API_KEY | 기존 농식품 API 시간·난이도 보완용 선택 키. 실제 문서·연결 확인 후에만 사용 |
| GOOGLE_VISION_API_KEY | 영수증 DOCUMENT_TEXT_DETECTION |
| GEMINI_API_KEY | 사진 속 식재료 분석용 Google Gemini 키 |
| GEMINI_MODEL | 해당 프로젝트에서 이미지 입력·구조화 출력을 지원하는 실제 모델 ID |
| ALLOWED_ORIGINS | 허용할 정확한 Origin을 쉼표로 구분. URL 경로·와일드카드는 넣지 않음 |
| EXTERNAL_API_MODE | 검증용 `mock` 또는 실연결 `live`. 키 누락 시 자동 모의 응답으로 대체하지 않음 |

SUPABASE_URL과 SUPABASE_ANON_KEY는 Edge 런타임의 기본 설정을 사용한다.
필요 시 SUPABASE_PUBLISHABLE_KEY로 공개 키를 별도 지정할 수 있다.
service_role/secret key를 클라이언트나 호출 헤더에 사용하지 않는다.

함수 배포는 본인이 Supabase CLI에 로그인한 환경에서 공식 CLI로 실행한다:

```
supabase login
supabase link --project-ref xmmyrlcmufshwapyvwlb
supabase functions deploy recipes
supabase functions deploy ocr
supabase functions deploy recognize
```

`config.toml`의 게이트웨이 JWT 검사는 publishable key 호환을 위해 false지만,
각 함수가 Auth `/user`로 사용자 JWT를 확인한 후에만 외부 요청을 실행한다.
인증·쿼터 확인 코드 없이 함수를 공개하지 않는다. CORS는 정확한 배포 Origin만 허용한다.
DB의 `consume_api_budget`이 한국 날짜별로 사용자당 recipes 50회, OCR 20회, 사진 인식 20회를 제한한다(202611070001에서 OCR 10회→20회, 사진 인식 5회→20회).
이 수치는 비용 절감을 위한 테스트 제한이며 공급자의 무료 사용량 보장은 아니다.
실패·재시도도 제한을 사용할 수 있다. 프로젝트 전체 AI 한도는 공급자에서 따로 확인한다.

`mock` 모드는 `{mode:'mock',...}`를 반환하며 화면에서는 모의 연결 안내를 표시한다.
모의 식재료를 실제 등록하거나 모의 레시피를 실검색 결과로 보이지 않게 한다.
`live` 모드에서 키 누락은 503, 인증 실패는 401, 일일 제한은 429로 구분한다.
실제 외부 오류 본문·키가 포함된 URL은 응답이나 로그로 출력하지 않는다.

기존 레시피 파서·시간/난이도 보완 로직은 `scripts/sync-edge-shared.mjs`로 Edge용 사본을 생성한다.
변경 후 `pnpm edge:sync`, 배포 전 `pnpm edge:check`를 실행한다.
농식품 보완 서버가 실패하면 기존 동작처럼 주 API 결과를 유지하고 추정 표시를 사용한다.

공식 API 문서:
- https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&show_cnt=10&start_idx=1&svc_no=COOKRCP01
- https://docs.cloud.google.com/vision/docs/ocr
- https://ai.google.dev/gemini-api/docs/structured-output
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/cors

실제 키와 모델 선택 전에는 실 API 호출·정확도·무료 한도 내 운영을 검증한 것으로 간주하지 않는다.
사진 속 신선도나 소비기한은 AI가 추측하지 않도록 요청한다. 이름·분류·개수도 사용자 확인이 필요하다.

### 4. 프런트엔드·GitHub Pages 설정: 사람이 설정

로컬 `.env.local`에는 공개용 두 값만 추가한다. 기존 파일의 다른 값은 덮어쓰지 않는다.

```
VITE_SUPABASE_URL=<Supabase Project URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_로 시작하는 공개 키>
```

GitHub Repository → Settings → Secrets and variables → Actions → **Variables**에
같은 이름의 두 값을 등록한다. workflow는 공개 두 값만 빌드에 전달한다.
기존 VITE_RECIPE_ENDPOINT/VITE_OCR_ENDPOINT는 새 Pages 빌드에서 사용하지 않는다.
외부 API 비밀 키는 Supabase Secrets에만 둔다. Publishable key는 공개용이며 RLS가 실제 권한을 제어한다.
Vite 설정은 허용되지 않은 공개 변수나 비밀 키 형태를 발견하면 값을 출력하지 않고 빌드를 중단한다.

확인: 공개 설정 후 재시작/재빌드 → 마이페이지 로그인 버튼 → 저장·새로고침·다른 기기
조회·소비/폐기·저장 레시피 확인. DB 미적용 시 데이터를 불러오지 못했다는 안내를 표시한다.
로그인 전 기록 가져오기는 사용자가 해당 버튼을 눌렀을 때만 업로드한다.

### 5. 로컬 검증

```
pnpm test
pnpm build
pnpm edge:check
pnpm check:build-secrets
```

별도 Deno 검사:
```
pnpm dlx deno check supabase/functions/recipes/index.ts supabase/functions/ocr/index.ts supabase/functions/recognize/index.ts
```

테스트는 메모리/모의 HTTP 응답을 사용하며 실제 키를 쓰지 않는다.
기존 리포트 테스트는 최신 master의 기간 안내 문구에 맞춰 기대값만 갱신했다.

## 범위 밖

이번 연결 작업에서는 유료 인프라, 자동 과금 전환, 웹 푸시 예약 발송, 서버 대시보드 배치 작업을 추가하지 않는다.
관리점수는 기존 로컬 오전 6시 계산을 유지한다. 알림·서버 점수 배치는 추후 별도 기능으로 추가한다.
무료 DB 자동 백업이 제공된다고 가정하지 않으며 테스트 데이터도 필요하면 별도 백업한다.

## 적용 및 검증 결과 (2026-10-24)

- DB 마이그레이션 001~004 적용 완료. 기존 데이터 초기화 없음.
- recipes, ocr, recognize 세 Edge 함수 배포 완료.
- 사용자 승인 후 세 함수의 legacy JWT 검사를 OFF로 저장. 함수 내부에서 Auth 사용자 JWT를 확인하고 DB 호출 제한을 적용한다.
- 실제 배포 주소: 비로그인 GET recipes / POST ocr / POST recognize 모두 401, 허용 Pages Origin의 OPTIONS 204, 허용하지 않은 Origin 403 확인.
- pnpm test: 240개 통과. pnpm build, edge:check, check:build-secrets 및 세 함수 Deno 타입 검사 통과.
- SQL 사용자 분리·버전 충돌·잘못된 입력 원자성·익명 접근 차단·호출 제한 테스트 통과. 가상 계정과 기록은 ROLLBACK.
- 별도 localhost:5188에서 직접 등록 → 상세 → 0% 소비 완료 → 목록 제거 → 마이페이지 소비 건수 반영 확인. 사용자의 기존 개발 포트 데이터는 변경하지 않았다.
- Google OAuth, 공개 URL/key의 로컬·GitHub Variables 설정, 외부 API Secrets는 사용자 설정이 남아 있다. 실제 OAuth·외부 AI 정확도·기기 간 동기화는 설정 후 검증한다.
- 비밀 키 신규 입력, Git 커밋·푸시는 수행하지 않았다.

브라우저 단일 파일 배포 재현: node scripts/bundle-edge-functions.mjs 실행 후 생성되는 supabase/bundles/<함수명>.ts를 대시보드 Editor에 사용한다. 번들 폴더는 Git에서 제외된다. CLI 배포는 원본 functions 폴더를 사용한다.

증빙: setup-screenshots/supabase-functions-deployed.png, supabase-auth-settings.png, supabase-isolation-pass.png, local-regression-consumed.png.

## Google 로그인 설정 진행 (2026-10-24)

- 대시보드에서 Google 제공자 ENABLED 확인. Client Secret은 읽거나 기록하지 않았다.
- Site URL: https://younjeong-814.github.io/kokjipseotest/
- 허용 Redirect URLs: 위 배포 주소와 http://127.0.0.1:5173/, http://127.0.0.1:5174/, http://127.0.0.1:5175/ (사용자 승인 후 저장, 대시보드 성공 메시지 확인).
- 로컬 .env.local에 공개 URL/publishable key만 추가했고 기존 비밀 값은 보존했다. .env.local은 Git 제외 확인.
- 공개 설정 후 빌드와 비밀 값 누출 검사 통과.
- http://127.0.0.1:5174/#mypage → Google로 로그인 → Google 계정 선택 화면 도달 확인. 사용자 계정 선택·동의와 로그인 복귀 후 DB 연결 검증은 진행 대기.
- 증빙: setup-screenshots/supabase-redirect-urls.png.

### 실제 Google 로그인 검증 완료

사용자가 Google 계정 선택·동의를 완료한 뒤 로컬 5174 마이페이지에서 계정명, 로그아웃 버튼, 클라우드 데이터 불러오기 성공을 확인했다. 새로고침 후에도 로그인 유지 및 DB 재조회 성공을 확인했다. 실사용 기록 생성·업로드는 하지 않았다. 실제 클라우드 쓰기 및 다른 기기 검증은 별도 진행한다. 증빙: setup-screenshots/google-login-success.png.
