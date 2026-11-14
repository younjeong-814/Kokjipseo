# 모달 노출과 설문 제출 연결

기존 1차 모달 표시는 브라우저 localStorage에만 남았다. 이번 연결 이후의 기록은
`ut_survey_events`(shown/clicked), `ut_survey_links`(단계별 참여 코드),
`ut_survey_submissions`(단계별 Google Forms 응답 ID)에 저장한다.
이전 응답·모달 노출을 임의로 생성하거나 기존 응답을 계정에 추정 매칭하지 않는다.

## 기록 기준

- `OverlayDialog.showModal()` 성공 후에만 노출 기록을 요청한다. 안내 대상 여부를
  조회한 것과 실제 모달 노출은 서로 다르다.
- 활성 UT 수집 동의가 있는 현재 Auth 계정에만 기록한다. 계정 ID를 클라이언트가
  지정하지 않으며 일반 사용자는 기록 테이블 직접 읽기/쓰기를 할 수 없다.
- 같은 모달 마운트의 StrictMode 재실행·재시도는 같은 event_key로 중복 제거한다.
  새로운 모달 표시에는 새 키를 사용한다. 따라서 노출 기록 수와 고유 계정 수는 다르다.
- 1차는 서버 식재료/등록 이력이 있어야 기록한다. 2차는 본인 발송 완료 digest와
  기존 2차 초대 코드가 있어야 한다. 다른 사람의 메일 링크로 노출을 위조할 수 없다.
- Google Forms에는 이메일·계정 ID 대신 임의 참여 코드만 미리 채운다.
  사용자가 연결 정보를 바꾸면 올바른 계정 연결을 보장할 수 없으므로 안내 문구와
  UUID 입력 검증을 둔다. 이 코드는 로그인이나 냉장고 데이터 접근 권한이 아니다.
- 브라우저의 제출 완료 클릭이나 설문 링크 클릭으로 응답 완료를 기록하지 않는다.
  Google Forms 제출 트리거의 서버 호출만 실제 제출로 기록한다.
- 같은 Google 응답 ID를 재전송해도 한 번만 기록한다. 동일 계정의 새로운 응답 ID는
  별도 응답으로 세므로 실제 응답 건수와 제출 고유 계정 수를 함께 본다.
- 브라우저/네트워크 장애로 노출·클릭 기록이 누락될 수 있다. 정확한 픽셀 가시성이나
  화면을 본 사람의 주의를 보장하는 감사 기록은 아니다.

## 구성

1. `202611140001_survey_tracking.sql` 적용.
2. `ut-survey-complete` 배포. gateway JWT 대신 함수 내부 전용 secret을 검사한다.
3. `UT_SURVEY_SECRET`을 Supabase Secrets와 Apps Script Script Properties에 동일하게
   저장한다. 실제 값은 Git·프런트엔드·SQL 문서·실행 로그에 넣지 않는다.
4. 1차 Forms에 바인딩된 Apps Script에 `scripts/survey-forms.gs`를 저장하고,
   `configureSurveyForms`를 실행한다. 현재 Forms의 참여 코드 공개 항목은
   1차 `entry.443967875`, 2차 `entry.1461618647`이다. 기존 질문·응답은 보존한다.
5. `checkSurveyConnection`은 생성될 수 없는 nil UUID를 보내 두 단계의 인증과 DB
   연결을 확인한다. 응답 422가 정상이며 실제 설문 응답/제출 기록을 추가하지 않는다.
6. `installSurveyTriggers`로 두 양식의 실제 제출 트리거를 설치한다. 같은 프로젝트에서
   다시 실행해도 기존 트리거를 중복 생성하지 않는다.
7. 웹앱의 공개 항목 설정을 반영해 배포한다. Forms를 교체하면 공개 entry 설정도
   확인해야 한다. GitHub Actions 공개 변수로 기본 설정을 덮어쓸 수 있다.

기존 `ut_second_survey.completed_at`도 2차 제출 시 갱신하여 완료 후 재안내를 막는다.
기존 `ut-second-survey-complete` 경로는 과거 코드 호환을 위해 제거하지 않는다.

## 조회와 한계

`supabase/setup/survey-report.sql`에서 노출·클릭·실제 제출 건수와 고유 계정을 본다.
과거 Google Forms 응답에는 참여 코드가 없어 새 연결 기록에 포함되지 않는다.
Forms 전체 응답 수는 기존 응답까지 포함하므로 새 DB 제출 수와 다를 수 있다.
제출 트리거 실행 실패는 Apps Script 실행 목록에서 확인한다. 연결 실패를 성공으로
표시하지 않으며 기존 응답 자체는 Google Forms에 남는다.
