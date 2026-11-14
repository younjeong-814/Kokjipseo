import {useCallback,useRef,useState} from 'react';
import {supabase} from '../cloud/client';
import {entrySource} from './UTTracker';

export function useSurveyTracking(stage:1|2,digest:string|null=null,enabled=true){
 const shownKey=useRef(crypto.randomUUID());
 const clickedKey=useRef(crypto.randomUUID());
 const inflight=useRef<Promise<void>|null>(null);
 const [code,setCode]=useState<string|null>(null);
 const [error,setError]=useState(false);
 const record=useCallback(async(type:'shown'|'clicked')=>{
  if(!enabled||!supabase)return null;
  const {data,error}=await supabase.rpc('record_ut_survey_event',{
   p_stage:stage,p_event_type:type,p_event_key:type==='shown'?shownKey.current:clickedKey.current,
   p_digest:digest,p_source:entrySource(),
  });
  if(error||typeof data!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data))throw new Error('survey_tracking_unavailable');
  return data;
 },[stage,digest,enabled]);
 const onShown=useCallback(()=>{
  if(!enabled||inflight.current)return;
  inflight.current=(async()=>{
   // The registration event can arrive before the ingredient upload finishes.
   // Retry the same idempotent event; consent and ownership stay server-checked.
   for(let attempt=0;attempt<3;attempt++){
    try{const value=await record('shown');setCode(value);setError(false);return;}
    catch{if(attempt===2)throw new Error('survey_tracking_unavailable');await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));}
   }
  })().catch(()=>setError(true)).finally(()=>{inflight.current=null;});
 },[record,enabled]);
 const onClick=()=>{void record('clicked').catch(()=>{});};
 return {code,error,onShown,onClick};
}
