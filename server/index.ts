import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.ts";

// 3000 is often taken by other local tools (Open WebUI, React dev servers), so default to 3005.
const port = Number(process.env.PORT || 3005);

const server = createApp(new Anthropic()).listen(port, () => {
  console.log(`SDR Outreach is running at http://localhost:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use by another program. Set PORT to a different number in your .env file and run npm start again.`);
    process.exit(1);
  }
  throw error;
});
