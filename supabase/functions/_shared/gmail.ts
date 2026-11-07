import type {Env} from './http.ts';
import {validEmail, type MailTransport} from './emailNotifications.ts';

/** Minimal SMTP message shape (nodemailer-compatible). */
export type SmtpMessage = {from:{name:string;address:string};to:string;subject:string;text:string};
export type SmtpResult = {accepted?:unknown[];rejected?:unknown[];messageId?:string};
export type SmtpSend = (message:SmtpMessage)=>Promise<SmtpResult>;

function reportFailure(error:unknown){
  // Log only stable classifiers; never the message (may echo addresses or credentials).
  const value=error as {code?:unknown;responseCode?:unknown};
  const code=typeof value?.code==='string'&&/^[A-Z_]{2,20}$/.test(value.code)?value.code:'unclassified';
  const responseCode=typeof value?.responseCode==='number'?value.responseCode:null;
  console.warn('gmail_delivery_failure',JSON.stringify({stage:'smtp',code,responseCode}));
}

/**
 * Gmail SMTP (smtp.gmail.com:465, implicit TLS) with a Google App Password.
 * App Passwords do not expire like OAuth refresh tokens. Ports 25/587 are blocked on Supabase Edge, so 465 only.
 * Gmail has no provider idempotency guarantee: do not attach this to the retrying reminder worker.
 */
export function createGmailVerificationTransport(env:Env,send:SmtpSend|null=null):MailTransport|null {
  const user=env.GMAIL_USER?.trim(),password=env.GMAIL_APP_PASSWORD?.replaceAll(' ','');
  const sender=env.GMAIL_SENDER_EMAIL?.trim()||user;
  if(!user||!validEmail(user)||!password||!sender||!validEmail(sender))return null;
  let transporter:Promise<SmtpSend>|null=null;
  const deliver:()=>Promise<SmtpSend>=()=>send?Promise.resolve(send):(transporter??=import('npm:nodemailer@6.9.16').then(module=>{
    const mailer=(module.default??module).createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass:password},
      connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:20_000});
    return (message:SmtpMessage)=>mailer.sendMail(message);
  }).catch(error=>{transporter=null;throw error;}));
  return async(mail)=>{
    if(mail.kind!=='verification')throw new Error('gmail_reminder_dispatch_not_enabled');
    if(!validEmail(mail.to)||!/^\d{6}$/.test(mail.code))throw new Error('invalid_verification_mail');
    const message:SmtpMessage={
      from:{name:'콕집서',address:sender},to:mail.to,subject:'[콕집서] 이메일 인증번호 안내',
      text:`콕집서 이메일 인증번호는 ${mail.code}입니다.\n\n5분 이내에 입력해 주세요.\n직접 요청하지 않았다면 이 메일을 무시해 주세요.\n인증번호를 다른 사람에게 알려주지 마세요.`,
    };
    let result:SmtpResult;
    // Never retry an ambiguous send automatically, or expose the provider's response.
    try{result=await (await deliver())(message);}
    catch(error){reportFailure(error);throw new Error('gmail_send_failed');}
    if(!Array.isArray(result?.accepted)||!result.accepted.some(v=>String(v).toLowerCase()===mail.to.toLowerCase()))throw new Error('gmail_send_unconfirmed');
  };
}
