# sdr-outreach

A tool to help SDRs write first-touch outreach for LinkedIn, email and phone, whether you're new to prospecting or have done it for years.

Enter one prospect and what you sell, and AI (Claude, or a free model on your own computer) drafts a LinkedIn connection note and follow-up, a cold email, and a phone opener with discovery questions and a voicemail. **Guide me** mode (on by default) explains why each draft works, adds tips to the form, and lists what to do next. Turn it off in the top corner to see only the drafts.

Nothing is sent for you. You copy each draft and send it from your own accounts.

## Run it

You need Node.js 22.18 or newer (`.nvmrc` pins 22), plus either an Anthropic API key or a free local AI model (see [Use a free local model](#use-a-free-local-model-no-api-key)).

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY, or switch to a local model below
npm start
```

Open http://localhost:3005.

If something else already uses port 3005, set `PORT` in `.env` to another free number (for example `PORT=3010`) and open that port instead. The app runs on 3005 rather than 3000 because tools like Open WebUI often take 3000.

## Use a free local model (no API key)

The app can draft with a model running on your own computer through [Ollama](https://ollama.com), so it costs nothing per draft. Local models are smaller than Claude, so expect drafts that need a bit more editing.

On Windows:

1. Install Ollama from https://ollama.com/download (skip this if you already use it with Open WebUI). It runs in the system tray.
2. In PowerShell, download a model: `ollama pull llama3.1:8b`. On a laptop with 8 GB of RAM or less, use `llama3.2:3b` instead.
3. In your `.env` file, set:
   ```
   AI_PROVIDER=local
   LOCAL_AI_MODEL=llama3.1:8b
   ```
4. Run `npm start` again. The terminal should say it is drafting with the local model.

Any server with an OpenAI-compatible chat API also works, such as LM Studio or Open WebUI. For Open WebUI, set `LOCAL_AI_URL=http://localhost:3000/api`, set `LOCAL_AI_MODEL` to a model name from its model picker, and set `LOCAL_AI_API_KEY` to a key from Open WebUI's Settings > Account.

## Develop

```bash
npm test         # API and prompt tests (no API key needed)
npm run typecheck
```

GitHub Actions runs both on every pull request and on pushes to `main`.

- `server/drafts.ts` holds the prompt, the output schema and the Claude call.
- `server/local.ts` calls a local or self-hosted model over the OpenAI chat completions API.
- `server/app.ts` is the Express server with the `/api/drafts` endpoint.
- `public/` is the page itself (plain HTML, CSS and JavaScript).
