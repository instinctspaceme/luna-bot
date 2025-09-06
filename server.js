import express from "express";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { Telegraf } from "telegraf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const configPath = path.join(__dirname, "config.json");
let config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function quickSentiment(text = "") {
  const pos = ["great","good","awesome","love","happy","yes","cool","thanks","nice","amazing","wonderful","fantastic","perfect"];
  const neg = ["bad","sad","angry","hate","no","terrible","awful","worse","pain","annoy","sorry","ugh"];
  let score = 0;
  const t = text.toLowerCase();
  pos.forEach(w => (t.includes(w) ? (score += 1) : null));
  neg.forEach(w => (t.includes(w) ? (score -= 1) : null));
  return Math.max(-2, Math.min(2, score));
}

// =============================
// 📌 CHAT ENDPOINT (Web UI)
// =============================
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [], voice } = req.body;

    const messages = [
      { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
      ...history.slice(-12),
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const reply = completion.choices[0].message.content || "…";
    const sentiment = quickSentiment(`${message}\n${reply}`);

    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice || config.voice || "alloy",
      input: reply
    });
    const audioBuffer = Buffer.from(await tts.arrayBuffer());

    res.json({
      reply,
      audio: audioBuffer.toString("base64"),
      sentiment
    });
  } catch (err) {
    console.error("API /chat error:", err);
    res.status(500).json({ reply: "⚠️ Error: " + err.message });
  }
});

// =============================
// 📌 CONFIG ENDPOINTS
// =============================
app.post("/config", (req, res) => {
  const { personality, voice, background, avatar } = req.body;
  if (personality) config.personality = personality;
  if (voice) config.voice = voice;
  if (background) config.background = background;
  if (avatar) config.avatar = avatar;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  res.json({ success: true, config });
});

app.get("/config", (req, res) => res.json(config));

// =============================
// 📌 TELEGRAM BOT
// =============================
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.start((ctx) => ctx.reply("👋 Hi! I am Luna. Send me text or a voice note!"));

  bot.on("text", async (ctx) => {
    try {
      const userText = ctx.message.text;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
          { role: "user", content: userText }
        ]
      });
      const reply = completion.choices[0].message.content || "…";
      await ctx.reply(reply);

      const ttsResponse = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: config.voice || "alloy",
        input: reply
      });
      const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      await ctx.replyWithVoice({ source: audioBuffer });
    } catch (err) {
      ctx.reply("⚠️ Error: " + err.message);
    }
  });

  bot.launch();
  console.log("✅ Telegram bot running");
}

// =============================
// 📌 START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Luna running on http://localhost:${PORT}`);
});
