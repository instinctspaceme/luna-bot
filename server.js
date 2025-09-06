// Luna "last-night" baseline:
// - Web UI
// - OpenAI TTS voice (realistic)
// - Telegram (POLLING by default; WEBHOOK optional via env)
// - Simple sentiment → avatar expression switch
// No admin/config files.

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import Sentiment from "sentiment";
import { Telegraf } from "telegraf";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const sentiment = new Sentiment();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// ---- Simple in-memory config matching last-night filenames
const EXPRESSIONS = {
  neutral: "luna1.png",
  happy: "luna_happy.png",
  sad: "luna_sad.png",
};
const DEFAULT_VOICE = "alloy"; // OpenAI TTS voice

// Utility: verify file exists in /public; if not, fall back to neutral
function expressionPath(name) {
  const abs = path.join(__dirname, "public", name);
  return fs.existsSync(abs) ? name : EXPRESSIONS.neutral;
}

// ---- Chat: canned reply + expression from sentiment
app.post("/api/chat", async (req, res) => {
  const { message = "" } = req.body || {};
  const s = sentiment.analyze(message);

  let expression = EXPRESSIONS.neutral;
  if (s.score >= 2) expression = EXPRESSIONS.happy;
  else if (s.score <= -2) expression = EXPRESSIONS.sad;

  const reply =
    s.score >= 2
      ? "Love that energy! 😊"
      : s.score <= -2
      ? "I’m here with you. 💜"
      : "Got it.";

  res.json({ reply, expression: expressionPath(expression) });
});

// ---- Voice: OpenAI TTS → mp3 buffer
app.post("/api/voice", async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "No text" });

  try {
    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: DEFAULT_VOICE,
      input: text,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("TTS error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Telegram: POLLING by default (set TELEGRAM_MODE=webhook to use webhook)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_MODE = (process.env.TELEGRAM_MODE || "polling").toLowerCase(); // "polling" | "webhook"
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "";

if (TELEGRAM_TOKEN) {
  const bot = new Telegraf(TELEGRAM_TOKEN);

  bot.start((ctx) => ctx.reply("Hi! I’m Luna 🌙"));
  bot.on("text", async (ctx) => {
    const text = ctx.message.text || "";
    const s = sentiment.analyze(text);
    let prefix = "Luna";
    if (s.score >= 2) prefix = "Luna (happy)";
    else if (s.score <= -2) prefix = "Luna (concerned)";
    await ctx.reply(`${prefix}: ${text}`);
  });

  if (TELEGRAM_MODE === "webhook" && PUBLIC_URL) {
    app.use(bot.webhookCallback("/telegram"));
    bot.telegram
      .setWebhook(`${PUBLIC_URL.replace(/\/+$/, "")}/telegram`)
      .then(() => console.log("✅ Telegram webhook set"))
      .catch((e) => console.error("Webhook set failed:", e.message));
  } else {
    // Default: polling (matches earlier behavior)
    bot.launch()
      .then(() => console.log("✅ Telegram polling started"))
      .catch((e) => console.error("Polling failed:", e.message));

    // Graceful stop on server signals (for local/dev)
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  }
} else {
  console.warn("⚠️ TELEGRAM_TOKEN not set. Telegram disabled.");
}

// ---- Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
