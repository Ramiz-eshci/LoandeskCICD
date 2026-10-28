import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('renders the platform page with valid navigation and the application login link', async () => {
  for (const configuredUrl of ['', 'https://app.example.com/login']) {
    const server = await createServer({
      configFile: false,
      plugins: [react()],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      define: { 'import.meta.env.VITE_APP_LOGIN_URL': JSON.stringify(configuredUrl) },
    });
    try {
      const { default: App } = await server.ssrLoadModule('/src/App.tsx');
      const markup = renderToStaticMarkup(React.createElement(App));
      const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      assert.equal(ids.length, new Set(ids).size, 'Page IDs must be unique');
      for (const match of markup.matchAll(/href="#([^"]+)"/g)) {
        assert.ok(ids.includes(match[1]), `Missing navigation target: ${match[1]}`);
      }
      assert.equal((markup.match(/<h1\b/g) || []).length, 1);
      const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
      assert.ok(header.includes(`href="${configuredUrl || 'http://localhost:4200/login'}">Get started`));
      assert.ok(markup.includes('/images/uk-lending-map.svg'));
      assert.ok(markup.includes('Illustrative product view'));
      assert.ok(markup.includes('sample data'));
      assert.ok(markup.includes('From enquiry to live loan.'));
      assert.ok(markup.includes('Explore a sample case through the lending lifecycle'));
      assert.ok(markup.includes('aria-controls="journey-case"'));
      assert.ok(markup.includes('data-playing="false"'), 'Server rendering respects reduced motion until the browser preference is known');
      assert.ok(markup.includes('Animation disabled by reduced motion preference'));
      assert.ok(markup.includes('Your team decides.'));
      for (const name of ['name', 'email', 'company', 'interest', 'message']) {
        assert.ok(markup.includes(`name="${name}"`));
      }
      assert.ok(markup.includes('Book a LoanDesk demo.'));
      assert.ok(markup.includes('Request a demo'));
      assert.ok(!markup.includes('Copy request'));
      assert.ok(!markup.includes('enquiries/public'));
      assert.ok(!markup.includes('info@loandesk.example'));

      const { DemoConfirmation } = await server.ssrLoadModule('/src/components/EnquiryForm.tsx');
      const confirmation = renderToStaticMarkup(React.createElement(DemoConfirmation, { email: 'jane@firm.co.uk' }));
      assert.ok(confirmation.includes('Demo request received'));
      assert.ok(confirmation.includes('arrange a tailored demonstration of LoanDesk'));
      assert.ok(confirmation.includes('<strong>jane@firm.co.uk</strong>'));
      assert.ok(confirmation.includes('tabindex="-1"'));
      assert.ok(confirmation.includes('aria-labelledby="demo-success-title"'));
      assert.ok(confirmation.includes('href="#platform"'));
      assert.ok(!confirmation.includes('Your reference'));
      assert.ok(!confirmation.includes('request_ref'));
      assert.ok(!confirmation.includes('<form'));
    } finally {
      await server.close();
    }
  }
});
