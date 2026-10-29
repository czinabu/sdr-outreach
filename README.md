# sdr-outreach

A tool to help SDRs write first-touch outreach for LinkedIn, email and phone, whether you're new to prospecting or have done it for years.

Enter one prospect and what you sell, and AI (Claude, or a free model on your own computer) drafts a LinkedIn connection note and follow-up, a cold email, and a phone opener with discovery questions and a voicemail.

- **Industry playbooks:** pick the prospect's industry (software, healthcare, manufacturing, finance, real estate, professional services, retail, education, construction, local business) and the drafts use the angles and wording that work in that market, plus a day-by-day follow-up sequence across LinkedIn, email and phone.
- **Research-backed drafting rules:** short, plain-text emails with one low-pressure question, pitch-free LinkedIn notes, and phone openers that admit it's a cold call and ask for 30 seconds, following published data from Gong and Reply.io.
- **Context:** add the company's website and the opener mentions something relevant from it. You can also attach a PDF or text file (a case study, pricing sheet or call notes) and say what it is. If a site or file can't be read, you still get drafts, with a note saying it wasn't used.
- **Guide me** mode adds tips under each channel, common objections and how to answer them, and explains why each draft works.

- **Contacts:** save a prospect and the tool keeps every set of drafts you write for them, puts a date on each step of their follow-up sequence, and shows who's due today. Check steps off as you go, set a status (replied, meeting booked, not interested), add their email, phone and LinkedIn, and export everything to CSV for HubSpot, Salesforce or a spreadsheet. Contacts are saved in `data/contacts.json` on your computer; back that file up if you want to keep them.

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

### LM Studio instead of Ollama

1. In LM Studio, download and load a chat model (around 7–8B, such as Llama 3.1 8B Instruct or Qwen 2.5 7B Instruct).
2. Open the **Developer** tab and start the local server. It runs at `http://localhost:1234`.
3. Copy the model's identifier from that tab and put it in `.env`:
   ```
   AI_PROVIDER=local
   LOCAL_AI_URL=http://localhost:1234/v1
   LOCAL_AI_MODEL=qwen2.5-7b-instruct
   ```
4. When loading the model, set its context length to at least 8192. With a website and a file attached, the prompt plus the drafts can go past LM Studio's 4096 default.

### Other servers

Any server with an OpenAI-compatible chat API also works. For Open WebUI, set `LOCAL_AI_URL=http://localhost:3000/api`, set `LOCAL_AI_MODEL` to a model name from its model picker, and set `LOCAL_AI_API_KEY` to a key from Open WebUI's Settings > Account.

## Develop

```bash
npm test         # API and prompt tests (no API key needed)
npm run typecheck
```

GitHub Actions runs both on every pull request and on pushes to `main`.

- `server/drafts.ts` holds the prompt, the output schema and the Claude call.
- `server/local.ts` calls a local or self-hosted model over the OpenAI chat completions API.
- `server/playbooks.ts` holds the industry playbooks and follow-up sequences.
- `server/attachment.ts` reads text out of attached PDFs and text files.
- `server/website.ts` fetches a company web page and pulls out its readable text.
- `server/contacts.ts` stores saved contacts in `data/contacts.json`, works out follow-up dates and builds the CSV export.
- `server/app.ts` is the Express server with the `/api/drafts` and `/api/contacts` endpoints.
- `public/` is the page itself (plain HTML, CSS and JavaScript).
