import {useEffect} from 'react';
import {supabase} from '../cloud/client';
import {UTConsentSheet} from './UTConsentSheet';
import {UTWelcomeSheet} from './UTWelcomeSheet';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const screenName=/^[a-z0-9-]{1,40}$/;
const SOURCE_KEY='kokjipseo:entry-source';
const appKeys=new Map<string,string>();
const clickKeys=new Map<string,string>();
// 모듈 단위로 둬서 개발 모드(StrictMode)의 effect 재실행에도 같은 화면을 두 번 남기지 않는다.
const lastScreens=new Map<string,string>();
type UTEventType='app_open'|'notification_click'|'ingredient_view'|'ingredient_manage'|'screen_view';
/** 첫 진입 경로(?src=pickply, 메일 링크의 source=email)를 이 탭에서 기억한다. 사용자 식별에는 쓰지 않는다. */
export function entrySource():'pickply'|'email'|null{
  const search=new URLSearchParams(window.location.search).get('src');
  const hash=new URLSearchParams(window.location.hash.split('?')[1]??'').get('source');
  const found=hash==='email'?'email':search==='pickply'?'pickply':null;
  try{
    if(found)sessionStorage.setItem(SOURCE_KEY,found);
    const saved=sessionStorage.getItem(SOURCE_KEY);
    return saved==='pickply'||saved==='email'?saved:null;
  }catch{return found;}
}
export const currentScreen=()=>window.location.hash.slice(1).split('?')[0]||'home';
export async function recordUTEvent(type:UTEventType,key:string=crypto.randomUUID(),ingredientId?:string,deliveryId?:string,screen?:string){
  if(!supabase)return;
  // Database checks active UT consent, owner, delivery status and idempotency.
  await supabase.rpc('record_ut_event',{p_event_key:key,p_event_type:type,p_ingredient_id:ingredientId??null,p_delivery_id:deliveryId??null,p_screen:screen??null,p_source:entrySource()});
}
export async function recordManagedActivity(userId:string,activity:{id:string;itemId:string}){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${userId}:${activity.id}`));
  const hex=[...new Uint8Array(digest)].slice(0,16).map(v=>v.toString(16).padStart(2,'0')).join('');
  const key=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  await recordUTEvent('ingredient_manage',key,activity.itemId);
}
/** Optional UT tracking cannot block or modify fridge CRUD. No collection before DB consent. */
export function UTTracker({userId,initialIngredientCount}:{userId:string;initialIngredientCount:number}){
  useEffect(()=>{
    if(!appKeys.has(userId))appKeys.set(userId,crypto.randomUUID());
    entrySource();
    const report=(event?:Event)=>{
      const query=new URLSearchParams(window.location.hash.split('?')[1]??'');
      const item=query.get('item'),delivery=query.get('delivery')??new URLSearchParams(window.location.search).get('delivery');
      const consentChanged=event?.type==='kokjipseo:notification-preferences-changed';
      void recordUTEvent('app_open',appKeys.get(userId)).catch(()=>{});
      const screen=currentScreen();
      // 같은 화면을 반복 기록하지 않는다. 동의 직후에는 현재 화면을 다시 기록한다.
      if(screenName.test(screen)&&(lastScreens.get(userId)!==screen||consentChanged)){lastScreens.set(userId,screen);void recordUTEvent('screen_view',crypto.randomUUID(),undefined,undefined,screen).catch(()=>{});}
      if(window.location.hash.startsWith('#ingredient-detail')&&item&&uuid.test(item))void recordUTEvent('ingredient_view',crypto.randomUUID(),item).catch(()=>{});
      if(delivery&&uuid.test(delivery)){
        const mapKey=userId+':'+delivery;
        if(!clickKeys.has(mapKey))clickKeys.set(mapKey,crypto.randomUUID());
        void recordUTEvent('notification_click',clickKeys.get(mapKey),undefined,delivery).catch(()=>{});
      }
    };
    report();window.addEventListener('hashchange',report);window.addEventListener('kokjipseo:notification-preferences-changed',report);
    return()=>{window.removeEventListener('hashchange',report);window.removeEventListener('kokjipseo:notification-preferences-changed',report);};
  },[userId]);
  return <><UTWelcomeSheet key={`welcome:${userId}`} userId={userId}/><UTConsentSheet key={`survey:${userId}`} userId={userId} initialIngredientCount={initialIngredientCount}/></>;
}
