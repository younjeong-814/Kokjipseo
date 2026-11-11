# 2차 사용성 설문 연결

1. Supabase에 `202611100001_second_survey.sql`을 적용하고 `ut-second-survey-complete` 함수와 변경된 `email-reminder-worker`를 배포합니다. 새 알림 메일부터 냉장고 링크에 발송 묶음 ID가 포함됩니다.
2. Google Forms 편집 권한이 있는 팀원이 설문에 필수 단답형 **참여 코드** 항목을 추가합니다. 양식의 미리 채우기 기능으로 링크를 만들어 `entry.숫자` 키를 확인합니다. 이 키를 GitHub Actions 변수 `VITE_UT_SECOND_SURVEY_ENTRY`에 설정하고 웹앱을 빌드합니다. 로컬에서는 같은 이름을 `.env.local`에 설정합니다.
3. 임의로 생성한 비밀 값을 Supabase Edge Function secret `UT_SECOND_SURVEY_SECRET`과 Google Apps Script의 동일한 이름의 스크립트 속성에 저장합니다. Apps Script 속성 `UT_SECOND_SURVEY_ENDPOINT`에는 배포한 함수 URL을 넣습니다.
4. 양식에 연결된 Apps Script에 아래 함수를 넣고 **양식에서 → 양식 제출 시** 설치형 트리거를 등록합니다. 코드 항목의 제목은 양식과 일치해야 합니다.

```javascript
function completeSecondSurvey(event) {
  const codeAnswer = event.response.getItemResponses()
    .find(answer => answer.getItem().getTitle() === '참여 코드');
  if (!codeAnswer) throw new Error('참여 코드 항목을 찾을 수 없습니다.');

  const properties = PropertiesService.getScriptProperties();
  const result = UrlFetchApp.fetch(properties.getProperty('UT_SECOND_SURVEY_ENDPOINT'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + properties.getProperty('UT_SECOND_SURVEY_SECRET') },
    payload: JSON.stringify({ code: String(codeAnswer.getResponse()).trim() }),
    muteHttpExceptions: true,
  });
  if (result.getResponseCode() !== 204) {
    throw new Error('2차 설문 완료 기록 실패 (' + result.getResponseCode() + ')');
  }
}
```

참여 코드는 임의의 값이며, Google Forms로 계정 ID나 이메일 주소를 전달하지 않습니다. 링크만 열고 제출하지 않은 경우 다음 D-1·당일 메일에서 다시 안내합니다. 참여 코드 없이 이미 제출된 응답은 계정과 자동 연결할 수 없습니다. 이전의 발송 묶음 ID가 없는 메일에서는 2차 설문 진입을 추적할 수 없습니다.
