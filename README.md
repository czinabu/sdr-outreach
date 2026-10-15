# sdr-outreach

A tool to help SDRs write first-touch outreach for LinkedIn, email and phone, whether you're new to prospecting or have done it for years.

Enter one prospect and what you sell, and Claude drafts a LinkedIn connection note and follow-up, a cold email, and a phone opener with discovery questions and a voicemail. **Guide me** mode (on by default) explains why each draft works, adds tips to the form, and lists what to do next. Turn it off in the top corner to see only the drafts.

Nothing is sent for you. You copy each draft and send it from your own accounts.

## Run it

You need Node.js 22.18 or newer (`.nvmrc` pins 22) and an Anthropic API key.

```bash
npm install
cp .env.example .env   # then paste your key after ANTHROPIC_API_KEY=
npm start
```

Open http://localhost:3000.

## Develop

```bash
npm test         # API and prompt tests (no API key needed)
npm run typecheck
```

GitHub Actions runs both on every pull request and on pushes to `main`.

- `server/drafts.ts` holds the prompt, the output schema and the Claude call.
- `server/app.ts` is the Express server with the `/api/drafts` endpoint.
- `public/` is the page itself (plain HTML, CSS and JavaScript).
