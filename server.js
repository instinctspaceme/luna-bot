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

// --- tiny helper: sentiment (server-side fallback for Telegram)
function quickSentiment(text = "") {
  const pos = ["great","good","awesome","love","happy","yes","cool","thanks","nice","amazing","wonderful","fantastic","perfect"];
  const neg = ["bad","sad","angry","hate","no","terrible","awful","worse","pain","annoy","sorry","ugh"];
  let score = 0;
  const t = text.toLowerCase();
  pos.forEach(w => (t.includes(w) ? (score += 1) : null));
  neg.forEach(w => (t.includes(w) ? (score -= 1) : null));
  return Math.max(-2, Math.min(2, score)); // -2..2
}

// =============================
// 📌 CHAT ENDPOINT (Web UI)
// =============================
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [], voice, pitch, rate } = req.body;

    const messages = [
      { role: "system", content: `You are Luna, a ${config.personality} AI assistant. Be warm, concise, and helpful.` },
      ...history.slice(-12), // keep the last 12 to control token use
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const reply = completion.choices[0].message.content || "…";

    // Simple sentiment for emotion mapping on client avatar + voice
    const sentiment = quickSentiment(`${message}\n${reply}`);

    // TTS for web (non-streaming; we also return sentiment to drive avatar)
    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice || config.voice || "alloy",
      input: reply
    });
    const audioBuffer = Buffer.from(await tts.arrayBuffer());

    res.json({
      reply,
      audio: audioBuffer.toString("base64"),
      sentiment // -2..2
    });
  } catch (err) {
    console.error("API /chat error:", err);
    res.status(500).json({ reply: "⚠️ Error: " + err.message });
  }
});

// =============================
// 📌 CONFIG ENDPOINTS (global defaults)
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
// 📌 TEST VOICE
// =============================
app.post("/test-voice", async (req, res) => {
  try {
    const { voice } = req.body;
    const ttsResponse = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice || config.voice || "alloy",
      input: "Hello! This is Luna. Nice to meet you."
    });
    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    res.json({ audio: audioBuffer.toString("base64"), voice: voice || config.voice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================
// 📌 TELEGRAM BOT (text + voice in/out)
// =============================
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.start((ctx) => ctx.reply("👋 Hi! I am Luna. Send me text or a voice note!"));

  // Handle text
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
      const s = quickSentiment(`${userText}\n${reply}`);
      const speed = s >= 1 ? 1.1 : s <= -1 ? 0.9 : 1.0;

      // Send text
      await ctx.reply(reply);

      // Send voice reply (Telegram "voice" = OGG Opus; OpenAI returns mp3)
      const ttsResponse = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: config.voice || "alloy",
        input: reply
      });
      const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      await ctx.replyWithVoice({ source: audioBuffer }, { caption: s >= 1 ? "🙂" : s <= -1 ? "😔" : "🤖" });
    } catch (err) {
      console.error("Telegram text error:", err);
      ctx.reply("⚠️ Error: " + err.message);
    }
  });

  // Handle voice messages
  bot.on("voice", async (ctx) => {
    try {
      const fileId = ctx.message.voice.file_id;
      const file = await ctx.telegram.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      // Download voice
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      // Transcribe (OGG/Opus -> use generic ogg type)
      const transcription = await openai.audio.transcriptions.create({
        file: new Blob([audioBuffer], { type: "audio/ogg" }),
        model: "gpt-4o-mini-transcribe"
      });

      const userText = transcription.text || "(couldn't transcribe)";
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
          { role: "user", content: userText }
        ]
      });

      const reply = completion.choices[0].message.content || "…";
      const s = quickSentiment(`${userText}\n${reply}`);

      await ctx.reply(`🗣️ You said: “${userText}”\n\n${reply}`);

      const ttsResponse = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: config.voice || "alloy",
        input: reply
      });
      const replyBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      await ctx.replyWithVoice({ source: replyBuffer }, { caption: s >= 1 ? "🙂" : s <= -1 ? "😔" : "🤖" });
    } catch (err) {
      console.error("Telegram voice error:", err);
      ctx.reply("⚠️ Error handling voice: " + err.message);
    }
  });

  bot.launch();
  console.log("✅ Telegram bot running with voice support");
}

// =============================
// 📌 START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Luna running on http://localhost:${PORT}`);
});
