# Luna Bot

Luna is an AI companion bot with:
- Web chat UI (at /)
- Telegram integration
- Age gate + safety filters

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   OPENAI_API_KEY=sk-xxxx
   ADMIN_TOKEN=changeme
   TELEGRAM_TOKEN=xxxxx (optional)
   PORT=10000
   ```

3. Run locally:
   ```bash
   node server.js
   ```

4. Deploy to Render/Railway/Fly.io and set env vars in dashboard.
