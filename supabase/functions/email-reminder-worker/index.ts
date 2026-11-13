import {createResendTransport} from '../_shared/emailTransport.ts';
import {createGmailReminderTransport} from '../_shared/gmailReminders.ts';
import {createOperationalReminderHandler} from '../_shared/operationalReminders.ts';
const env=Deno.env.toObject();
// Still planning-only until the scheduler and EMAIL_DISPATCH_ENABLED=true are configured.
const transport=createResendTransport(env)??createGmailReminderTransport(env);
Deno.serve(createOperationalReminderHandler(env,transport));
