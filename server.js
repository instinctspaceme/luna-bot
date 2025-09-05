// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import fetch from "node-fetch";
import { Telegraf } from "telegraf";
import OpenAI from "openai";

// ===== ENV VARS =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (!OPENAI_API_KEY || !TELEGRAM_BOT_TOKEN || !RENDER_EXTERNAL_URL) {
  console.error("❌ Missing required env vars: OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, RENDER_EXTERNAL_URL");
  process.exit(1);
}

// ===== CORE SETUP =====
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Ensure folders exist
const PUBLIC_DIR = path.join(__dirname, "public");
const AVATARS_DIR = path.join(PUBLIC_DIR, "avatars");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR);
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

// ===== CONFIG =====
const CONFIG_FILE = path.join(__dirname, "config.json");
let config = {
  personality: "friendly",
  avatar: "luna_avatar.png", // default file name in /public/avatars
  rotation: "none"           // none | daily-random | daily-sequence
};
if (fs.existsSync(CONFIG_FILE)) {
  try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch { /* ignore */ }
}
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }

// ===== AVATAR ROTATION =====
function getTodayIndex() {
  const ref = new Date("2025-01-01T00:00:00Z");
  const now = new Date();
  return Math.floor((now - ref) / (1000 * 60 * 60 * 24));
}
function listAvatars() {
  if (!fs.existsSync(AVATARS_DIR)) return [];
  return fs.readdirSync(AVATARS_DIR).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
}
function getActiveAvatar() {
  const files = listAvatars();
  if (!files.length) return config.avatar;

  if (config.rotation === "daily-random") {
    // deterministic “random”: index-of-day
    const idx = getTodayIndex() % files.length;
    return files[idx];
  } else if (config.rotation === "daily-sequence") {
    const idx = getTodayIndex() % files.length;
    return files[idx];
  }
  // fixed
  return config.avatar;
}

// ===== OPENAI HELPERS =====
function systemStyle(personality) {
  switch (personality) {
    case "formal":  return "You are Luna. Be professional and concise.";
    case "playful": return "You are Luna. Be witty, upbeat, and helpful.";
    case "tutor":   return "You are Luna. Be a patient teacher; explain step-by-step.";
    case "gamer":   return "You are Luna. Be a gamer buddy; casual and punchy.";
    default:        return "You are Luna. Warm, supportive, and practical.";
  }
}

async function chatReply(text) {
  const messages = [
    { role: "system", content: systemStyle(config.personality) },
    { role: "user", content: text }
  ];
  const out = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });
  return out.choices?.[0]?.message?.content?.trim() || "…";
}

async function synthesizeSpeechToFile({ text, format = "mp3" }) {
  // Returns saved file path under /public/audio
  const fileBase = `tts_${Date.now()}.${format}`;
  const fullPath = path.join(AUDIO_DIR, fileBase);
  const resp = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
    // Some SDKs infer format from extension; others accept explicit param:
    // format: format  // uncomment if your SDK requires it
  });
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(fullPath, buffer);
  return `/audio/${fileBase}`;
}

async function transcribeFileToText(filePath, mime = "audio/webm") {
  // model name may be "gpt-4o-transcribe" (new) or "whisper-1" (legacy)
  const model = "gpt-4o-transcribe";
  const stream = fs.createReadStream(filePath);
  const tr = await openai.audio.transcriptions.create({
    file: stream,
    model
  });
  // Some SDKs return { text }, others nested — normalize:
  const text = tr.text || tr?.data?.text || "";
  return text.trim();
}

// ===== TELEGRAM BOT =====
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Text -> AI -> text + voice (as Voice)
bot.on("text", async (ctx) => {
  try {
    const userText = ctx.message.text || "";
    const replyText = await chatReply(userText);

    // Send text
    await ctx.reply(replyText);

    // Send voice (OGG) as optional nicety
    try {
      const audioUrl = await synthesizeSpeechToFile({ text: replyText, format: "ogg" });
      await ctx.replyWithVoice({ source: path.join(PUBLIC_DIR, audioUrl.replace("/audio/", "audio/")) });
    } catch (e) {
      console.warn("TTS (telegram) error:", e.message);
    }
  } catch (e) {
    console.error("Telegram text handler error:", e.message);
    await ctx.reply("⚠️ Sorry, I hit an issue replying.");
  }
});

// Voice note -> STT -> AI -> text + voice
bot.on(["voice", "audio"], async (ctx) => {
  try {
    const fileId = (ctx.message.voice || ctx.message.audio).file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId); // signed URL
    const tempPath = path.join("uploads", `tg_${Date.now()}.ogg`);
    const r = await fetch(fileLink.href);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(tempPath, buf);

    const transcript = await transcribeFileToText(tempPath, "audio/ogg");
    fs.unlink(tempPath, () => {});

    if (!transcript) {
      await ctx.reply("I couldn't understand that voice message. Want to try again?");
      return;
    }

    const replyText = await chatReply(transcript);
    await ctx.reply(`🗣️ You said: ${transcript}\n\n💬 ${replyText}`);

    try {
      const audioUrl = await synthesizeSpeechToFile({ text: replyText, format: "ogg" });
      await ctx.replyWithVoice({ source: path.join(PUBLIC_DIR, audioUrl.replace("/audio/", "audio/")) });
    } catch (e) {
      console.warn("TTS (telegram voice) error:", e.message);
    }
  } catch (e) {
    console.error("Telegram voice handler error:", e.message);
    await ctx.reply("⚠️ Voice processing failed.");
  }
});

// Webhook route
app.use(bot.webhookCallback("/telegram-webhook"));
bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}/telegram-webhook`);

// ===== API: Web Chat =====
app.post("/api/chat", async (req, res) => {
  const { message, tts } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message" });

  try {
    const reply = await chatReply(message);
    let audio = "";
    if (tts) {
      try {
        audio = await synthesizeSpeechToFile({ text: reply, format: "mp3" });
      } catch (e) {
        console.warn("TTS (web) error:", e.message);
      }
    }
    res.json({ reply, activeAvatar: getActiveAvatar(), audio });
  } catch (e) {
    console.error("API /chat error:", e.message);
    res.status(500).json({ error: "AI Error" });
  }
});

// ===== API: Direct TTS =====
app.post("/api/tts", async (req, res) => {
  try {
    const { text, format = "mp3" } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });
    const url = await synthesizeSpeechToFile({ text, format });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== API: STT (upload audio) =====
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    const mime = req.file.mimetype || "audio/webm";
    const text = await transcribeFileToText(req.file.path, mime);
    fs.unlink(req.file.path, () => {});
    res.json({ text });
  } catch (e) {
    console.error("Transcribe error:", e.message);
    res.status(500).json({ error: "Transcription failed" });
  }
});

// ===== API: Settings & Avatars =====
app.get("/api/settings", (req, res) => {
  res.json({ ...config, activeAvatar: getActiveAvatar() });
});
app.post("/api/settings", (req, res) => {
  const { personality, avatar, rotation } = req.body || {};
  if (personality) config.personality = personality;
  if (avatar) config.avatar = avatar;
  if (rotation) config.rotation = rotation;
  saveConfig();
  res.json({ success: true, config });
});
app.get("/api/avatars", (req, res) => {
  res.json(listAvatars());
});

// Health
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Luna running on http://localhost:${PORT}`));
