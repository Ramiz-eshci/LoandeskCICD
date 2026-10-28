'use strict';

/**
 * Debug: reply-to-info-request matching WITHOUT the webhook (client 17-10-2026).
 *
 *   node scripts/debug-email-replies.js            -> show Graph subscriptions + last 10 inbox mails, dry run
 *   node scripts/debug-email-replies.js --apply    -> also process them (upload attachments to the case)
 *   node scripts/debug-email-replies.js --top=25   -> look at more inbox mails
 */

require('dotenv').config({ quiet: true });
const path = require('path');
global.basePath = global.basePath || path.join(__dirname, '..');

const db = require('../config/database');
const { config } = require('../config/env');
const { getGraphClient } = require('../config/microsoftGraph.service');
const emailReply = require('../services/emailReply.service');

const apply = process.argv.includes('--apply');
const topArg = process.argv.find((a) => a.startsWith('--top='));
const top = topArg ? Number(topArg.split('=')[1]) || 10 : 10;

(async () => {
  const graph = getGraphClient();
  const mb = config.graph.mailbox;
  console.log(`Mailbox: ${mb}\nWebhook URL in .env: ${config.graph.webhookUrl}\n`);

  // 1. Subscriptions
  const subs = await graph.api('/subscriptions').get();
  console.log('== Graph subscriptions ==');
  if (!(subs.value || []).length) console.log('  NONE  -> webhook will never fire. Start ngrok first, then restart the API.');
  for (const s of subs.value || []) {
    const mine = s.notificationUrl === config.graph.webhookUrl ? '  <-- this .env' : '';
    console.log(`  ${s.id}  ${s.notificationUrl}  exp ${s.expirationDateTime}${mine}`);
  }

  // 2. Last INFO_REQUEST rows in email_log
  console.log('\n== Last info-request e-mails in email_log ==');
  const logs = await db.query(
    `SELECT TOP 5 email_log_id, event_key, module, record_id, record_ref, subject, status,
            conversation_id, internet_message_id, sent_at
       FROM email_log WHERE event_key LIKE '%INFO_REQUEST' ORDER BY email_log_id DESC`);
  for (const l of logs) {
    console.log(`  #${l.email_log_id} ${l.event_key} ${l.record_ref} [${l.status}] "${l.subject}"`);
    console.log(`      conversation_id: ${l.conversation_id ? 'yes' : 'NULL'}   internet_message_id: ${l.internet_message_id ? 'yes' : 'NULL'}`);
  }

  // 3. Inbox
  console.log(`\n== Last ${top} inbox mails ==`);
  const res = await graph.api(`/users/${mb}/mailFolders/inbox/messages`)
    .select('id,subject,body,from,receivedDateTime,hasAttachments,internetMessageId,conversationId,internetMessageHeaders')
    .orderby('receivedDateTime desc').top(top).get();

  for (const m of res.value || []) {
    const from = m.from?.emailAddress?.address;
    const orig = await emailReply.findOriginal(m);
    const done = await db.query('SELECT TOP 1 status, module, record_id FROM outlook_processed_emails WHERE message_id = @p0', [m.id]);
    console.log(`\n  ${m.receivedDateTime}  ${from}  "${m.subject}"  attachments=${m.hasAttachments}`);
    console.log(`    match: ${orig ? `${orig.module} #${orig.record_id} ${orig.record_ref} via ${orig.method}` : 'NO MATCH'}`);
    if (process.argv.includes('--dump')) {
      const atts = (await graph.api(`/users/${mb}/messages/${m.id}/attachments`).select('id,name,size,isInline,contentType').get()).value || [];
      console.log(`    attachments (${atts.length}):`);
      atts.forEach((a) => console.log(`      - ${a.name}  type=${a['@odata.type']}  inline=${a.isInline}  size=${a.size}`));
      const hrefs = String(m.body?.content || '').match(/href="[^"]+"/gi) || [];
      if (hrefs.length) console.log(`    links in body:\n      ${hrefs.slice(0, 10).join('\n      ')}`);
    }
    if (done.length) console.log(`    already processed: ${done[0].status} ${done[0].module || ''} ${done[0].record_id || ''}`);
    if (orig && apply && !done.length) {
      const out = await emailReply.handleReply(m, async () =>
        ((await graph.api(`/users/${mb}/messages/${m.id}/attachments`).get()).value || []));
      console.log(`    APPLIED -> ${JSON.stringify(out)}`);
    }
  }
  if (!apply) console.log('\n(dry run - add --apply to upload the matched attachments)');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.statusCode || '', e.message); process.exit(1); });
