# LoanDesk website

React, Vite and TypeScript marketing website for lending firms and underwriting
teams. The hero illustrates the lending lifecycle; Get started opens the existing
Angular application's login page.

## Demo requests

The Book a LoanDesk demo form collects name, work email, company, area of
interest and an optional message. It posts JSON to `POST /api/demo-requests` and
shows confirmation only after the API acknowledges a saved request.

Requests are stored in `dbo.demo_requests`, separately from loan enquiries.
The response contains only `request_ref`, used internally to acknowledge the saved
request. The visitor sees a confirmation and their contact email, without the
database reference. There is no public read endpoint.
The retired borrower endpoint `POST /api/enquiries/public` has been removed.

The form preserves entered details on failure, displays server field errors,
and blocks repeated submissions while a request is in flight. This flow stores
demo enquiries; it does not send an email draft or an email notification.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

Set these public values in `.env`:

- `VITE_API_BASE_URL`: API base including `/api`; defaults locally to
  `http://localhost:3400/api`.
- `VITE_APP_LOGIN_URL`: full application login URL; defaults locally to
  `http://localhost:4200/login`. Set the deployed application URL before publishing.
- `VITE_SALES_EMAIL`: optional public contact address displayed on the page.

Run the backend from `../api`, and apply its schema migration with
`npm run migrate`. The demo table is created by
`20261014000001_create_demo_requests.js`. The API must allow the website's exact
origin in `CORS_ORIGINS`; the local website uses `http://localhost:5173`.

The demo endpoint uses a 16 KB JSON limit and allows 10 submissions per IP per
15 minutes. It is a public write-only route, mounted before the staff application's
transport encryption. Use HTTPS for the website and API in production.

## Checks and deployment

```bash
npm test
npm run lint
npm run build
```

Tests use Node's built-in runner with TypeScript support. The production build
outputs `dist/`. Set production API and application URLs before building;
Vite embeds these public environment values into the bundle.

## Structure

- `src/App.tsx` and `src/App.css`: page layout and shared styles.
- `src/content.ts`: product copy and public links.
- `src/components/LendingJourney.tsx`: animated sample case with stage selection,
  pause controls and reduced-motion support.
- `src/components/EnquiryForm.tsx`: software demo request form.
- `src/lib/demo.ts`: business form fields and validation.
- `src/lib/api.ts`: demo-request HTTP client and response handling.
- `test/`: validation, API response and page-render checks.

## Licences & attribution

* Photos (`public/images/*.jpg`): sourced from **Unsplash** — free to use,
  including commercially, with no permission or attribution required
  ([Unsplash Licence](https://unsplash.com/licence)). They are vendored
  locally so the site has zero third-party image dependencies.
* Logo, navy logo and favicon (`public/logo*.png`, `public/favicon.ico`):
  LoanDesk brand assets, copied from the main application's `front/public/`.
