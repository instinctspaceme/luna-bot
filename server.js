import express from "express";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { Telegraf } from "telegraf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const configPath = path.join(__dirname, "config.json");
let config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =============================
// 📌 CHAT ENDPOINT (Web UI)
// =============================
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const { voice, pitch, rate } = req.body; // per-user overrides

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
        { role: "user", content: userMessage }
      ]
    });

    const reply = completion.choices[0].message.content;

    // TTS
    const ttsResponse = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice || config.voice || "alloy",
      input: reply
    });

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

    res.json({
      reply,
      audio: audioBuffer.toString("base64"),
      pitch: pitch || 1,
      rate: rate || 1
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
  const { personality, voice, background } = req.body;
  config.personality = personality || config.personality;
  config.voice = voice || config.voice;
  config.background = background || config.background;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  res.json({ success: true, config });
});

app.get("/config", (req, res) => res.json(config));

// =============================
// 📌 TEST VOICE
// =============================
app.post("/test-voice", async (req, res) => {
  try {
    const { voice } = req.body;
    const ttsResponse = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice || "alloy",
      input: "Hello! This is a sample of Luna speaking."
    });
    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    res.json({ audio: audioBuffer.toString("base64"), voice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================
// 📌 TELEGRAM BOT
// =============================
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  bot.start((ctx) => ctx.reply("Hi! I am Luna 🤖. How can I help you today?"));

  bot.on("text", async (ctx) => {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
          { role: "user", content: ctx.message.text }
        ]
      });
      ctx.reply(completion.choices[0].message.content);
    } catch (err) {
      ctx.reply("⚠️ Error: " + err.message);
    }
  });

  bot.launch();
  console.log("✅ Telegram bot started");
}

// =============================
// 📌 START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Luna running on http://localhost:${PORT}`);
});
