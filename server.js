// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import { Configuration, OpenAIApi } from "openai";

// ========== ENVIRONMENT VARS ==========
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (!OPENAI_API_KEY || !TELEGRAM_BOT_TOKEN || !RENDER_EXTERNAL_URL) {
  console.error("❌ Missing required environment variables!");
  process.exit(1);
}

// ========== EXPRESS SETUP ==========
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ========== CONFIG ==========
const CONFIG_FILE = path.join(__dirname, "config.json");

// Load config or create default
let config = {
  personality: "friendly",
  avatar: "luna_avatar.png",
  rotation: "none" // none | daily-random | daily-sequence
};
if (fs.existsSync(CONFIG_FILE)) {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
}
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ========== OPENAI ==========
const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));

async function getAIResponse(userMessage) {
  let stylePrompt = "";
  switch (config.personality) {
    case "friendly":
      stylePrompt = "Reply in a warm, kind, supportive tone.";
      break;
    case "formal":
      stylePrompt = "Reply in a professional and polite style.";
      break;
    case "playful":
      stylePrompt = "Reply with humor, emojis, and a lighthearted style.";
      break;
    case "tutor":
      stylePrompt = "Reply like a patient teacher explaining concepts clearly.";
      break;
    case "gamer":
      stylePrompt = "Reply with gaming slang, hype, and gamer style.";
      break;
  }

  const completion = await openai.createChatCompletion({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `You are Luna, an AI assistant. ${stylePrompt}` },
      { role: "user", content: userMessage }
    ]
  });

  return completion.data.choices[0].message.content.trim();
}

// ========== TELEGRAM BOT ==========
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.on("text", async (ctx) => {
  const userMessage = ctx.message.text;
  const reply = await getAIResponse(userMessage);
  await ctx.reply(reply);
});

// ========== WEBHOOK ==========
app.use(bot.webhookCallback("/telegram-webhook"));
bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}/telegram-webhook`);

// ========== API ROUTES ==========

// Get current settings
app.get("/api/settings", (req, res) => {
  res.json(config);
});

// Update settings
app.post("/api/settings", (req, res) => {
  const { personality, avatar, rotation } = req.body;
  if (personality) config.personality = personality;
  if (avatar) config.avatar = avatar;
  if (rotation) config.rotation = rotation;

  saveConfig();
  res.json({ success: true, config });
});

// Avatar listing
app.get("/api/avatars", (req, res) => {
  const avatarDir = path.join(__dirname, "public", "avatars");
  const files = fs.readdirSync(avatarDir);
  res.json(files);
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Luna server running on http://localhost:${PORT}`);
});
