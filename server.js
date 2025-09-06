import express from "express";
import fs from "fs";
import path from "path";
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

/* -------- CONFIG -------- */
let config = {
  expressions: {
    happy: "luna_happy.png",
    sad: "luna_sad.png",
    neutral: "luna1.png"
  },
  voice: "alloy"
};

/* -------- CHAT ROUTE -------- */
app.post("/api/chat", async (req, res) => {
  const { message = "" } = req.body || {};
  const result = sentiment.analyze(message);
  let expression = config.expressions.neutral;

  if (result.score >= 2) expression = config.expressions.happy;
  else if (result.score <= -2) expression = config.expressions.sad;

  const reply =
    result.score >= 2 ? "That makes me happy! 🌸"
    : result.score <= -2 ? "I feel your sadness 💜"
    : "I’m listening.";

  res.json({ reply, expression });
});

/* ---- Voice (OpenAI TTS) ---- */
app.post("/api/voice", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "No text" });

  try {
    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: config.voice,
      input: text
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("TTS error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* -------- TELEGRAM -------- */
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || "";

if (TELEGRAM_TOKEN) {
  const bot = new Telegraf(TELEGRAM_TOKEN);
  bot.start(ctx => ctx.reply("Hi! I’m Luna 🌙"));
  bot.on("text", async ctx => {
    const text = ctx.message.text;
    const result = sentiment.analyze(text);
    let prefix = "Luna";
    if (result.score >= 2) prefix = "Luna (happy)";
    else if (result.score <= -2) prefix = "Luna (concerned)";
    await ctx.reply(`${prefix}: ${text}`);
  });

  app.use(bot.webhookCallback("/telegram"));
  if (PUBLIC_URL) {
    bot.telegram.setWebhook(`${PUBLIC_URL}/telegram`).catch(console.error);
  }
}

/* -------- START -------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
