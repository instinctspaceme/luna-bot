import express from "express";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";
import { Telegraf } from "telegraf";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -------- CONFIG --------
const configPath = path.join(__dirname, "config.json");
let config = {
  globalAvatar: "avatars/avatar.png",
  background: "default.jpg",
  voice: "alloy",
  expressions: {
    happy: "avatars/luna_happy.png",
    sad: "avatars/luna_sad.png",
    neutral: "avatars/avatar.png"
  },
  personality: "friendly and helpful"
};
if (fs.existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch (e) {
    console.warn("Could not read config.json, using defaults.", e.message);
  }
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// -------- OPENAI --------
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// sentiment helper
function quickSentiment(text = "") {
  const pos = ["great","good","awesome","love","happy","yes","cool","thanks","nice","amazing","wonderful","fantastic","perfect"];
  const neg = ["bad","sad","angry","hate","no","terrible","awful","worse","pain","annoy","sorry","ugh"];
  let score = 0;
  const t = text.toLowerCase();
  for (const w of pos) if (t.includes(w)) score += 1;
  for (const w of neg) if (t.includes(w)) score -= 1;
  return Math.max(-2, Math.min(2, score));
}

// -------- API: CONFIG --------
app.get("/config", (_req, res) => res.json(config));
app.post("/config", (req, res) => {
  const { personality, voice, background, globalAvatar, expressions } = req.body || {};
  if (personality) config.personality = personality;
  if (voice) config.voice = voice;
  if (background) config.background = background;
  if (globalAvatar) config.globalAvatar = globalAvatar;
  if (expressions) config.expressions = { ...config.expressions, ...expressions };
  saveConfig();
  res.json({ success: true, config });
});

// -------- API: AVATARS --------
app.get("/avatars", (_req, res) => {
  const avatars = [];
  try {
    const root = path.join(__dirname, "public");
    const dir1 = path.join(root, "avatars");
    const pick = (base, prefix = "") => {
      if (!fs.existsSync(base)) return;
      for (const f of fs.readdirSync(base)) {
        if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f)) {
          avatars.push(prefix ? `${prefix}/${f}` : f);
        }
      }
    };
    pick(dir1, "avatars");
    pick(root, "");
  } catch (err) {
    console.error("Avatar scan failed:", err);
  }
  res.json(avatars);
});

// -------- API: CHAT --------
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [], voice } = req.body;

    const messages = [
      { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
      ...history.slice(-12),
      { role: "user", content: message || "" }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const reply = completion.choices?.[0]?.message?.content || "…";
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
    res.status(500).json({ reply: "⚠️ Error: " + (err?.message || String(err)) });
  }
});

// -------- HEALTH --------
app.get("/health", (_req, res) => res.json({ ok: true }));

// -------- TELEGRAM --------
async function setupTelegram() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return;

  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply("👋 Hi! I’m Luna. Send text or voice."));
  bot.help((ctx) => ctx.reply("Type a message or send a voice note."));

  // text
  bot.on("text", async (ctx) => {
    const userText = ctx.message.text;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
        { role: "user", content: userText }
      ]
    });
    const reply = completion.choices?.[0]?.message?.content || "…";
    const s = quickSentiment(`${userText}\n${reply}`);

    await ctx.reply(reply);

    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: config.voice || "alloy",
      input: reply
    });
    const buf = Buffer.from(await tts.arrayBuffer());
    await ctx.replyWithVoice({ source: buf }, { caption: s >= 1 ? "🙂" : s <= -1 ? "😔" : "🤖" });
  });

  // voice
  bot.on("voice", async (ctx) => {
    const fileId = ctx.message.voice.file_id;
    const file = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

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
    const reply = completion.choices?.[0]?.message?.content || "…";
    const s = quickSentiment(`${userText}\n${reply}`);

    await ctx.reply(`🗣️ You said: “${userText}”\n\n${reply}`);

    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: config.voice || "alloy",
      input: reply
    });
    const replyBuf = Buffer.from(await tts.arrayBuffer());
    await ctx.replyWithVoice({ source: replyBuf }, { caption: s >= 1 ? "🙂" : s <= -1 ? "😔" : "🤖" });
  });

  const usePolling = String(process.env.TELEGRAM_USE_POLLING || "").toLowerCase() === "true";

  if (usePolling) {
    await bot.launch();
    console.log("🤖 Telegram launched (polling mode).");
  } else {
    const base = process.env.RENDER_EXTERNAL_URL;
    if (!base) return;
    const webhookPath = "/telegram";
    const webhookUrl = `${base}${webhookPath}`;
    app.use(bot.webhookCallback(webhookPath));
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`🤖 Telegram webhook set: ${webhookUrl}`);
  }
}
setupTelegram().catch(console.error);

// -------- START --------
app.listen(PORT, () => {
  console.log(`🚀 Luna running on http://localhost:${PORT}`);
});
