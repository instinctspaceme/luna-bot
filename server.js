// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import { WebSocketServer } from "ws";
import multer from "multer";

// ===== ENV =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

if (!OPENAI_API_KEY || !TELEGRAM_BOT_TOKEN || !RENDER_EXTERNAL_URL) {
  console.error("❌ Missing env vars: OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, RENDER_EXTERNAL_URL");
  process.exit(1);
}

// ===== Setup =====
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PUBLIC_DIR = path.join(__dirname, "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const AVATARS_DIR = path.join(PUBLIC_DIR, "avatars");
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Config =====
const CONFIG_FILE = path.join(__dirname, "config.json");
let config = {
  personality: "friendly",
  avatar: "luna_avatar.png",
  rotation: "none",
  voice: "alloy"
};
if (fs.existsSync(CONFIG_FILE)) {
  try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch {}
}
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// ===== Avatars =====
const listAvatars = () =>
  fs.readdirSync(AVATARS_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort();

const getTodayIndex = () => {
  const ref = new Date("2025-01-01T00:00:00Z");
  return Math.floor((Date.now() - ref.getTime()) / 86400000);
};

const getActiveAvatar = () => {
  const files = listAvatars();
  if (!files.length) return config.avatar;
  if (config.rotation === "daily-random" || config.rotation === "daily-sequence") {
    return files[getTodayIndex() % files.length];
  }
  return config.avatar;
};

// ===== Memory (per web session & telegram user) =====
const webMemory = new Map();      // key: sessionId, value: [{role, content}]
const tgMemory = new Map();       // key: telegramUserId, value: [{role, content}]
const MAX_TURNS = 12;

function pushMsg(store, key, msg) {
  const arr = store.get(key) || [];
  arr.push(msg);
  while (arr.length > MAX_TURNS) arr.shift();
  store.set(key, arr);
  return arr;
}
function getHistory(store, key) {
  return store.get(key) || [];
}

// ===== Language detect + voice map =====
async function detectLanguage(text) {
  if (!text || text.length < 2) return "en";
  const p = `Return only the ISO 639-1 language code for this text:\n"${text.slice(0, 400)}"`;
  const out = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: "Reply ONLY with the 2-letter code." }, { role: "user", content: p }]
  });
  const code = (out.choices?.[0]?.message?.content || "en").trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "en";
}
function voiceForLang(lang) {
  const map = { en: "alloy", es: "serene", fr: "verse", de: "verse", it: "serene", pt: "serene", ja: "alloy", ko: "alloy", zh: "alloy" };
  return map[lang] || config.voice || "alloy";
}

// ===== System prompt =====
function styleSystemPrompt() {
  switch (config.personality) {
    case "formal":  return "You are Luna. Be professional, precise, and concise.";
    case "playful": return "You are Luna. Be witty, upbeat, and fun while staying helpful.";
    case "tutor":   return "You are Luna. Be a patient teacher with clear, step-by-step explanations.";
    case "gamer":   return "You are Luna. Be a gamer buddy; casual, punchy, and hype but helpful.";
    default:        return "You are Luna. Warm, supportive, practical, and clear.";
  }
}

// ===== AI chat with memory =====
async function chatReplyWithMemory({ text, memoryStore, memoryKey }) {
  const history = getHistory(memoryStore, memoryKey);
  const messages = [
    { role: "system", content: styleSystemPrompt() },
    ...history,
    { role: "user", content: text }
  ];
  const out = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });
  const reply = out.choices?.[0]?.message?.content?.trim() || "…";
  pushMsg(memoryStore, memoryKey, { role: "user", content: text });
  pushMsg(memoryStore, memoryKey, { role: "assistant", content: reply });
  return reply;
}

// ===== TTS / STT =====
async function synthesizeSpeechToFile({ text, format = "mp3", lang }) {
  const fileBase = `tts_${Date.now()}.${format}`;
  const fullPath = path.join(AUDIO_DIR, fileBase);
  const voice = voiceForLang(lang || "en");
  const resp = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text
  });
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(fullPath, buffer);
  return `/audio/${fileBase}`;
}

async function transcribeFileToText(filePath) {
  const stream = fs.createReadStream(filePath);
  const tr = await openai.audio.transcriptions.create({
    file: stream,
    model: "gpt-4o-transcribe"
  });
  return (tr.text || tr?.data?.text || "").trim();
}

// ===== Telegram Bot =====
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.on("text", async (ctx) => {
  try {
    const uid = String(ctx.from.id);
    const replyText = await chatReplyWithMemory({
      text: ctx.message.text || "",
      memoryStore: tgMemory,
      memoryKey: uid
    });
    await ctx.reply(replyText);

    try {
      const lang = await detectLanguage(ctx.message.text || replyText);
      const url = await synthesizeSpeechToFile({ text: replyText, format: "ogg", lang });
      await ctx.replyWithVoice({ source: path.join(PUBLIC_DIR, url.replace("/audio/", "audio/")) });
    } catch (e) { console.warn("TTS send fail:", e.message); }
  } catch (e) {
    console.error("Telegram text err:", e.message);
    await ctx.reply("⚠️ Sorry, I had a glitch. Try again.");
  }
});

bot.on(["voice", "audio"], async (ctx) => {
  try {
    const uid = String(ctx.from.id);
    const fileId = (ctx.message.voice || ctx.message.audio).file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const temp = path.join(__dirname, `tg_${Date.now()}.ogg`);
    const r = await fetch(link.href);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(temp, buf);

    const transcript = await transcribeFileToText(temp);
    fs.unlink(temp, () => {});
    if (!transcript) return await ctx.reply("I couldn't understand that voice note — try again?");

    const replyText = await chatReplyWithMemory({
      text: transcript,
      memoryStore: tgMemory,
      memoryKey: uid
    });

    const lang = await detectLanguage(transcript);
    await ctx.reply(`🗣️ You: ${transcript}\n\n💬 Luna: ${replyText}`);
    try {
      const url = await synthesizeSpeechToFile({ text: replyText, format: "ogg", lang });
      await ctx.replyWithVoice({ source: path.join(PUBLIC_DIR, url.replace("/audio/", "audio/")) });
    } catch (e) { console.warn("TTS send fail:", e.message); }
  } catch (e) {
    console.error("Telegram voice err:", e.message);
    await ctx.reply("⚠️ Voice processing failed.");
  }
});

// Webhook + self-heal
app.use(bot.webhookCallback("/telegram-webhook"));
async function setupWebhook() {
  try {
    const expected = `${RENDER_EXTERNAL_URL}/telegram-webhook`;
    const info = await bot.telegram.getWebhookInfo();
    if (info.url !== expected) {
      console.log("🔄 Resetting Telegram webhook…");
      await bot.telegram.deleteWebhook();
      await bot.telegram.setWebhook(expected);
    } else {
      console.log("✅ Telegram webhook OK:", info.url);
    }
  } catch (e) {
    console.error("Webhook setup failed:", e.message);
  }
}
setupWebhook();

// ===== Web Chat API =====
app.post("/api/chat", async (req, res) => {
  const { message, tts, sid } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message" });
  try {
    const reply = await chatReplyWithMemory({
      text: message,
      memoryStore: webMemory,
      memoryKey: sid || "anon"
    });
    let audio = "";
    if (tts) {
      try {
        const lang = await detectLanguage(message);
        audio = await synthesizeSpeechToFile({ text: reply, format: "mp3", lang });
      } catch (e) { console.warn("TTS web error:", e.message); }
    }
    res.json({ reply, activeAvatar: getActiveAvatar(), audio });
  } catch (e) {
    console.error("API /chat error:", e.message);
    res.status(500).json({ error: "AI Error" });
  }
});

// ===== Settings (PIN-protected write) =====
app.get("/api/settings", (req, res) => {
  res.json({ ...config, activeAvatar: getActiveAvatar() });
});
function requirePin(req, res, next) {
  if ((req.headers["x-admin-pin"] || "") === ADMIN_PIN) return next();
  return res.status(401).json({ error: "Unauthorized" });
}
app.post("/api/settings", requirePin, (req, res) => {
  const { personality, avatar, rotation, voice } = req.body || {};
  if (personality) config.personality = personality;
  if (avatar) config.avatar = avatar;
  if (rotation) config.rotation = rotation;
  if (voice) config.voice = voice;
  saveConfig();
  res.json({ success: true, config });
});
app.get("/api/avatars", (req, res) => res.json(listAvatars()));

// ===== Avatar Upload (PIN-protected) =====
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATARS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `avatar_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});
app.post("/api/upload-avatar", requirePin, upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ success: true, filename: path.basename(req.file.path), list: listAvatars() });
});

// ===== Health =====
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ===== Start HTTP =====
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Luna running on http://localhost:${PORT}`));

// =====================================================================
// 🔊 WebSocket Live Call — partials + final + language-aware TTS
// =====================================================================
const wss = new WebSocketServer({ server, path: "/call" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://dummy");
  const sid = url.searchParams.get("sid") || Math.random().toString(36).slice(2);

  const temp = path.join(__dirname, `call_${Date.now()}_${sid}.webm`);
  let write = fs.createWriteStream(temp, { flags: "a" });

  // Partial transcription throttle
  let lastPartialAt = 0;
  async function emitPartial() {
    try {
      const now = Date.now();
      if (now - lastPartialAt < 1400) return;
      lastPartialAt = now;

      const copy = `${temp}.part`;
      if (!fs.existsSync(temp)) return;
      fs.copyFileSync(temp, copy);
      const text = (await transcribeFileToText(copy)) || "";
      fs.unlink(copy, () => {});
      if (text) ws.send(JSON.stringify({ type: "partial", transcript: text }));
    } catch (e) {
      // swallow partial errors
    }
  }

  ws.on("message", async (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "segment_end") {
          write.end(async () => {
            try {
              const text = await transcribeFileToText(temp);
              try { fs.unlinkSync(temp); } catch {}
              const reply = await chatReplyWithMemory({
                text: text || " ",
                memoryStore: webMemory,
                memoryKey: sid
              });
              const lang = await detectLanguage(text || reply || "en");
              const urlAudio = await synthesizeSpeechToFile({ text: reply, format: "mp3", lang });
              ws.send(JSON.stringify({ type: "result", transcript: text, reply, audio: urlAudio }));
            } catch (e) {
              ws.send(JSON.stringify({ type: "error", error: e.message }));
            } finally {
              try { write = fs.createWriteStream(temp, { flags: "a" }); } catch {}
            }
          });
        }
      } catch {
        // ignore malformed
      }
      return;
    }
    write.write(data, () => emitPartial());
  });

  ws.on("close", () => {
    try { write.end(); } catch {}
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
  });
});
