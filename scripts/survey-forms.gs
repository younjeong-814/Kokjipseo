// Bound Google Apps Script. Store UT_SURVEY_SECRET in Script Properties, never in this file.
const SURVEY_FORMS = [
 {stage:1,id:'1aoVPM8zLkBuzXuhECyTQGM5iBvaxFGDMpl2YQaubmGU'},
 {stage:2,id:'1MnS051RyLDyl-mURWcGKLygPjU0JQaf_asYG5tNqOT8'},
];
const SURVEY_ENDPOINT='https://xmmyrlcmufshwapyvwlb.supabase.co/functions/v1/ut-survey-complete';
const CODE_TITLE='참여 코드';

function configureSurveyForms(){
 const config=SURVEY_FORMS.map(def=>{
  const form=FormApp.openById(def.id);
  const matches=form.getItems(FormApp.ItemType.TEXT).filter(item=>item.getTitle()===CODE_TITLE);
  if(matches.length>1)throw new Error('참여 코드 항목이 중복되어 있습니다.');
  const item=matches.length?matches[0].asTextItem():form.addTextItem().setTitle(CODE_TITLE);
  item.setRequired(true).setHelpText('앱에서 자동 입력한 익명 참여 코드입니다. 수정하지 않고 제출해 주세요.');
  item.setValidation(FormApp.createTextValidation().requireTextMatchesPattern('^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$').build());
  const prefilled=form.createResponse().withItemResponse(item.createResponse('10000000-0000-4000-8000-000000000001')).toPrefilledUrl();
  const entry=prefilled.match(/[?&](entry\.\d+)=/)[1];
  return {stage:def.stage,entry,existingResponses:form.getResponses().length};
 });
 // Item IDs are public form configuration, not credentials or response content.
 console.log(JSON.stringify(config));
}

function installSurveyTriggers(){
 if(!PropertiesService.getScriptProperties().getProperty('UT_SURVEY_SECRET'))throw new Error('Script Properties의 UT_SURVEY_SECRET을 먼저 설정하세요.');
 const existing=ScriptApp.getProjectTriggers();
 SURVEY_FORMS.forEach(def=>{
  if(!existing.some(trigger=>trigger.getHandlerFunction()==='completeSurvey'&&trigger.getTriggerSourceId()===def.id))
   ScriptApp.newTrigger('completeSurvey').forForm(FormApp.openById(def.id)).onFormSubmit().create();
 });
 console.log('Survey submission triggers are configured.');
}

function checkSurveyConnection(){
 const secret=PropertiesService.getScriptProperties().getProperty('UT_SURVEY_SECRET');
 if(!secret)throw new Error('설문 제출 연결 설정이 필요합니다.');
 [1,2].forEach(stage=>{
  // gen_random_uuid() cannot generate the nil UUID: this never creates a submission.
  const response=UrlFetchApp.fetch(SURVEY_ENDPOINT,{method:'post',contentType:'application/json',
   headers:{Authorization:'Bearer '+secret},payload:JSON.stringify({stage,code:'00000000-0000-0000-0000-000000000000',responseId:'configuration-probe'}),muteHttpExceptions:true});
  if(response.getResponseCode()!==422)throw new Error('제출 연결 진단 실패: HTTP '+response.getResponseCode());
 });
 console.log('Both survey stages: server authentication and database connection verified; no responses created.');
}

function completeSurvey(event){
 if(!event||!event.response||!event.source)throw new Error('실제 양식 제출 이벤트가 필요합니다.');
 const def=SURVEY_FORMS.find(form=>form.id===event.source.getId());
 if(!def)throw new Error('허용되지 않은 양식입니다.');
 const answer=event.response.getItemResponses().find(value=>value.getItem().getTitle()===CODE_TITLE);
 const code=answer?String(answer.getResponse()).trim():'';
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(code))throw new Error('연결할 참여 코드가 없습니다.');
 const secret=PropertiesService.getScriptProperties().getProperty('UT_SURVEY_SECRET');
 if(!secret)throw new Error('제출 연결 설정이 필요합니다.');
 const result=UrlFetchApp.fetch(SURVEY_ENDPOINT,{method:'post',contentType:'application/json',
  headers:{Authorization:'Bearer '+secret},payload:JSON.stringify({stage:def.stage,code,responseId:event.response.getId()}),muteHttpExceptions:true});
 if(result.getResponseCode()!==204)throw new Error('설문 제출 연결 실패: HTTP '+result.getResponseCode());
}
