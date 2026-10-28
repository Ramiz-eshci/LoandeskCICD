'use strict';

/**
 * Local end-to-end test for email -> enquiry ingestion WITHOUT Microsoft Graph.
 *
 * It builds a fake Graph "message" object (exactly the shape our webhook fetches
 * from Graph) and runs it through the real ingestion service, so it exercises:
 *   extraction -> normalisation -> enquiry.service.create -> outlook_processed_emails.
 *
 * Prereq: `npm run migrate` has been run (needs the DB reachable).
 * Run:     node scripts/test-email-intake.js
 */

const db = require('../config/database');
const ingestion = require('../services/emailIngestion.service');

const fakeMessage = {
  id: 'TEST-' + Date.now(),                 // unique so it isn't skipped as a dup
  internetMessageId: '<test-' + Date.now() + '@example.com>',
  subject: 'Bridging finance enquiry',
  from: { emailAddress: { name: 'John Smith', address: 'john.smith@example.com' } },
  toRecipients: [{ emailAddress: { address: process.env.OUTLOOK_MAILBOX || 'intake@example.com' } }],
  ccRecipients: [],
  receivedDateTime: new Date().toISOString(),
  hasAttachments: false,
  body: {
    contentType: 'text',
    content:
      'Hi team,\n\nWe are looking for a facility of £250,000 over a period of 12 months, ' +
      'secured against 14 High Street, London, EC1A 1BB.\n\nKind regards,\nJohn Smith',
  },
};

(async () => {
  try {
    console.log('Ingesting fake message', fakeMessage.id, '...');
    const out = await ingestion.ingestMessage(fakeMessage, []);
    console.log('Result:', out);

    if (out.ok) {
      const rows = await db.query(
        `SELECT e.enquiry_id, e.enquiry_ref, e.applicant_name, e.email, e.amount_requested,
                e.term_months, e.property_address, s.code AS source_code, st.code AS status_code
           FROM enquiries e
           LEFT JOIN application_sources s ON s.application_source_id = e.application_source_id
           LEFT JOIN enquiry_statuses st ON st.enquiry_status_id = e.enquiry_status_id
          WHERE e.enquiry_id = @p0`,
        [out.enquiryId],
      );
      console.log('Created enquiry row:', rows[0]);
    }
  } catch (err) {
    console.error('TEST FAILED:', err);
  } finally {
    if (db.close) await db.close();
    process.exit(0);
  }
})();
