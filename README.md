# sdr-outreach

A tool to help SDRs write first-touch outreach for LinkedIn, email and phone, whether you're new to prospecting or have done it for years.

Enter one prospect and what you sell, and AI (Claude, or a free model on your own computer through LM Studio or Ollama) drafts a LinkedIn connection note and follow-up, a cold email, and a phone opener with discovery questions and a voicemail.

- **Industry playbooks:** pick the prospect's industry (software, healthcare, manufacturing, finance, real estate, professional services, retail, education, construction, local business) and the drafts use the angles and wording that work in that market, plus a day-by-day follow-up sequence across LinkedIn, email and phone.
- **Research-backed drafting rules:** short, plain-text emails with one low-pressure question, pitch-free LinkedIn notes, and phone openers that admit it's a cold call and ask for 30 seconds, following published data from Gong and Reply.io.
- **Context:** add the company's website and the opener mentions something relevant from it. You can also attach a PDF or text file (a case study, pricing sheet or call notes) and say what it is. If a site or file can't be read, you still get drafts, with a note saying it wasn't used.
- **Guide me** mode adds tips under each channel, common objections and how to answer them, and explains why each draft works.

- **Contacts:** save a prospect and the tool keeps every set of drafts you write for them, puts a date on each step of their follow-up sequence, and shows who's due today. Check steps off as you go, set a status (replied, meeting booked, not interested), add their email, phone and LinkedIn, and export everything to CSV for HubSpot, Salesforce or a spreadsheet. Contacts are saved in `data/contacts.json` on your computer; back that file up if you want to keep them.

Nothing is sent for you. You copy each draft and send it from your own accounts.

## Run it

You need Node.js 22.18 or newer (`.nvmrc` pins 22), plus either an Anthropic API key or a free local AI model.

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:3005, then open **Model settings** to choose which AI writes your drafts. The dot next to it turns green once the model is ready.

If something else already uses port 3005, set `PORT` in `.env` to another free number (for example `PORT=3010`) and open that port instead. The app runs on 3005 rather than 3000 because tools like Open WebUI often take 3000.

## Model settings

The **Model settings** page offers three choices. They're saved in your browser, and **Test connection** checks them.

- **Claude (Anthropic API):** best quality, a few cents per set of drafts. Paste an API key from https://console.anthropic.com/settings/keys. **Budget mode** switches to Claude Haiku, at about a tenth of a cent per set, with plainer drafts.
- **LM Studio (local, free):** in LM Studio, load a model, open the **Developer** tab, start the server, click **Server Settings** and switch on **Enable CORS**. The default address `http://localhost:1234/v1` works unless you changed the port.
- **Ollama (local, free):** install Ollama and download a model, for example `ollama pull gemma4:12b`. The default address is `http://localhost:11434/v1`. If Test connection can't reach it while it's running, set the `OLLAMA_ORIGINS` environment variable to `http://localhost:3005` and restart Ollama.

"Which model fits my computer?" suggests a model for your hardware, from Gemma 4 E2B on an 8 GB laptop up to Gemma 4 26B A4B on a 24 GB graphics card. Local models are smaller than Claude, so expect drafts that need a bit more editing. When you load a model in LM Studio, set its context length to at least 8192: with a website and a file attached, the prompt plus the drafts can go past LM Studio's 4096 default.

### Your API key and your privacy

- With LM Studio, Ollama or a key entered on the Model settings page, your browser talks to the model directly. The app's server only reads the website and file you add, builds the prompt, and checks the reply. It never receives your key.
- Your key is kept in the browser tab's session storage and forgotten when you close the tab. Only if you tick **Remember my key on this device** is it kept in the browser's local storage. Don't tick it on a shared computer.
- The key is only ever sent to `https://api.anthropic.com`, never to a local model server, and the address isn't configurable.
- The page's Content Security Policy only lets it load its own scripts and connect to Anthropic and to servers on this computer, so other sites and injected scripts can't receive your key or drafts. Local model addresses must be on `localhost` or `127.0.0.1`.
- The app only listens on 127.0.0.1, so other devices on your network can't open it or your contacts, and it refuses requests addressed to any other host name, which blocks DNS-rebinding attacks from other web pages.
- Use a key with a spending limit, and delete it at console.anthropic.com if you ever think it's been exposed.

### Setting the model in `.env` instead

If you'd rather not enter a key in the browser, put `ANTHROPIC_API_KEY` in `.env`, leave the key field on the Model settings page empty, and the server drafts with Claude for you. You can also set `AI_PROVIDER=local` with `LOCAL_AI_URL` and `LOCAL_AI_MODEL` (see `.env.example`) to have the server call a local model. That also works with servers that don't support CORS, such as Open WebUI: set `LOCAL_AI_URL=http://localhost:3000/api`, `LOCAL_AI_MODEL` to a model name from its model picker, and `LOCAL_AI_API_KEY` to a key from Open WebUI's Settings > Account.

## Develop

```bash
npm test         # API and prompt tests (no API key needed)
npm run typecheck
```

GitHub Actions runs both on every pull request and on pushes to `main`.

- `server/drafts.ts` holds the prompt, the output schema and the Claude call.
- `server/local.ts` calls a local or self-hosted model over the OpenAI chat completions API, and checks replies the browser got from one.
- `server/playbooks.ts` holds the industry playbooks and follow-up sequences.
- `server/attachment.ts` reads text out of attached PDFs and text files.
- `server/website.ts` fetches a company web page and pulls out its readable text.
- `server/contacts.ts` stores saved contacts in `data/contacts.json`, works out follow-up dates and builds the CSV export.
- `server/app.ts` is the Express server with the `/api/drafts` and `/api/contacts` endpoints, plus `/api/drafts/prompt` and `/api/drafts/parse` for when the browser calls the model itself.
- `public/` is the page itself (plain HTML, CSS and JavaScript). `public/models.js` is the Model settings page and the browser's calls to Anthropic, LM Studio and Ollama.
