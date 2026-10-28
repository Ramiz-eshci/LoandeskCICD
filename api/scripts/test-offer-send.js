'use strict';
/**
 * Run the REAL offer flow for an enquiry (save version -> send/email) and print
 * exactly where it succeeds or fails. Runs on the DB host (your Windows box).
 * Usage:  node scripts/test-offer-send.js <enquiryId>
 */
require('dotenv').config();
const db = require('../config/database');
const offer = require('../services/enquiry.offer.service');
const enquirySvc = require('../services/enquiry.service');

const fakeReq = { userData: { userId: 1 }, clientIp: '127.0.0.1' };

(async () => {
  const id = Number(process.argv[2]);
  if (!id) { console.error('Usage: node scripts/test-offer-send.js <enquiryId>'); process.exit(1); }

  // 0) do the tables exist?
  try {
    const t = await db.query("SELECT name FROM sys.tables WHERE name IN ('enquiry_indicatives','enquiry_offers')");
    console.log('Tables present:', t.map((r) => r.name).join(', ') || '(NONE — run: npm run migrate)');
    if (t.length < 2) { console.error('>> Missing tables. Run "npm run migrate" then "npm run seed" first.'); process.exit(2); }
  } catch (e) { console.error('DB check failed:', e.message); process.exit(2); }

  // 1) enquiry + applicant email
  const e = await enquirySvc.getById(id);
  if (!e) { console.error('Enquiry', id, 'not found'); process.exit(2); }
  console.log('Enquiry:', e.enquiry_ref, '| applicant:', e.applicant_name || e.company_name, '| email:', e.email || '(NONE)');
  if (!e.email) console.log('>> This enquiry has NO applicant email — the offer will refuse to send.');

  // 2) save a draft offer version
  const saved = await offer.saveOfferVersion(id, {}, fakeReq);
  console.log('saveOfferVersion:', JSON.stringify(saved));
  if (!saved.ok) process.exit(2);

  // 3) send it (generates PDFs + emails)
  const sent = await offer.sendOffer(id, saved.id, fakeReq);
  console.log('sendOffer RESULT:', JSON.stringify(sent, null, 2));
  process.exit(sent.ok && sent.emailed ? 0 : 2);
})().catch((e) => { console.error('THREW:', e && (e.stack || e.message || e)); process.exit(3); });
