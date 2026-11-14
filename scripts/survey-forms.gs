// Bound Google Apps Script. Store UT_SURVEY_SECRET in Script Properties, never in this file.
const SURVEY_FORMS = [
 {stage:1,id:'1aoVPM8zLkBuzXuhECyTQGM5iBvaxFGDMpl2YQaubmGU',codeItemId:1197603394},
 {stage:2,id:'1MnS051RyLDyl-mURWcGKLygPjU0JQaf_asYG5tNqOT8',codeItemId:1678404314},
];
const SURVEY_ENDPOINT='https://xmmyrlcmufshwapyvwlb.supabase.co/functions/v1/ut-survey-complete';
const CODE_TITLE='참여 코드';

function configureSurveyForms(){
 const config=SURVEY_FORMS.map(def=>{
  const form=FormApp.openById(def.id);
  const matches=form.getItems(FormApp.ItemType.TEXT).filter(item=>item.getId()===def.codeItemId);
  if(matches.length!==1)throw new Error('참여 코드 항목 ID를 확인하세요. 기존 질문을 삭제하고 다시 만들지 마세요.');
  const item=matches[0].asTextItem();
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
 // Container-bound Forms scripts can resolve event.response against the wrong
 // form for a trigger installed on another form. Resolve the trigger's actual
 // source and read that form explicitly instead of touching event.response.
 if(event&&event.triggerUid){
  const trigger=ScriptApp.getProjectTriggers().find(t=>t.getUniqueId()===String(event.triggerUid));
  const def=trigger&&SURVEY_FORMS.find(f=>f.id===trigger.getTriggerSourceId());
  if(!def)throw new Error('허용되지 않은 제출 트리거입니다.');
  syncSurveyForm(def);
  return;
 }
 if(!event||!event.response||!event.source)throw new Error('실제 양식 제출 이벤트가 필요합니다.');
 const def=SURVEY_FORMS.find(form=>form.id===event.source.getId());
 if(!def)throw new Error('허용되지 않은 양식입니다.');
 forwardSurveyResponse(def,event.response);
}

function syncSurveyResponses(){SURVEY_FORMS.forEach(syncSurveyForm);}

function syncSurveyForm(def){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  const properties=PropertiesService.getScriptProperties();
  const key='SURVEY_SYNC_CURSOR_'+def.stage;
  const previous=properties.getProperty(key);
  const since=previous?new Date(new Date(previous).getTime()-60000):new Date('2026-11-14T00:00:00Z');
  const responses=FormApp.openById(def.id).getResponses(since);
  let latest=since.getTime(),linked=0;
  responses.forEach(response=>{
   if(forwardSurveyResponse(def,response))linked++;
   latest=Math.max(latest,response.getTimestamp().getTime());
  });
  if(responses.length)properties.setProperty(key,new Date(latest).toISOString());
  console.log('stage '+def.stage+': '+linked+' linked responses checked');
 }finally{lock.releaseLock();}
}

function forwardSurveyResponse(def,response){
 // Item IDs survive title, description and ordering edits in Google Forms.
 const answer=response.getItemResponses().find(value=>value.getItem().getId()===def.codeItemId);
 const code=answer?String(answer.getResponse()).trim():'';
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(code))return false;
 const secret=PropertiesService.getScriptProperties().getProperty('UT_SURVEY_SECRET');
 if(!secret)throw new Error('제출 연결 설정이 필요합니다.');
 const result=UrlFetchApp.fetch(SURVEY_ENDPOINT,{method:'post',contentType:'application/json',
  headers:{Authorization:'Bearer '+secret},payload:JSON.stringify({stage:def.stage,code,responseId:response.getId()}),muteHttpExceptions:true});
 if(result.getResponseCode()===422){console.warn('stage '+def.stage+': unrecognized participation code; response retained in Forms');return false;}
 if(result.getResponseCode()!==204)throw new Error('설문 제출 연결 실패: HTTP '+result.getResponseCode());
 return true;
}
