import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);

createApp(new Anthropic()).listen(port, () => {
  console.log(`SDR Outreach is running at http://localhost:${port}`);
});
