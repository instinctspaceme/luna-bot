import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Memory file
const memoryFile = path.join(__dirname, "memory.json");
let memory = {};
if (fs.existsSync(memoryFile)) {
  memory = JSON.parse(fs.readFileSync(memoryFile, "utf-8"));
}

// Voice storage
const voicesDir = path.join(__dirname, "public", "voices");
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir, { recursive: true });

// --- Cleanup Config ---
const VOICE_TTL_SECONDS = process.env.VOICE_TTL_SECONDS
  ? Number(process.env.VOICE_TTL_SECONDS)
  : 60 * 60 * 24; // 24h default
const VOICE_MAX_FILES = process.env.VOICE_MAX_FILES
  ? Number(process.env.VOICE_MAX_FILES)
  : 200; // keep max 200 files
const CLEANUP_INTERVAL_MS = process.env.VOICE_CLEANUP_INTERVAL_MS
  ? Number(process.env.VOICE_CLEANUP_INTERVAL_MS)
  : 1000 * 60 * 60; // 1h default

// --- Helpers ---
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}

function safeUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch (_) {}
}

function cleanupVoiceFiles() {
  try {
    const files = fs
      .readdirSync(voicesDir)
      .map((f) => {
        const full = path.join(voicesDir, f);
        const stat = fs.statSync(full);
        return { file: f, full, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);

    const now = Date.now();

    // Remove by TTL
    for (const item of files) {
      const ageSec = (now - item.mtime) / 1000;
      if (ageSec > VOICE_TTL_SECONDS) {
        safeUnlink(item.full);
        console.log(`🧹 Removed old voice file: ${item.file}`);
      }
    }

    // Refresh list
    const remaining = fs
      .readdirSync(voicesDir)
      .map((f) => {
        const full = path.join(voicesDir, f);
        const stat = fs.statSync(full);
        return { file: f, full, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);

    // Enforce max count
    if (VOICE_MAX_FILES && remaining.length > VOICE_MAX_FILES) {
      const excess = remaining.length - VOICE_MAX_FILES;
      for (let i = 0; i < excess; i++) {
        safeUnlink(remaining[i].full);
        console.log(`🧹 Removed to enforce max: ${remaining[i].file}`);
      }
    }
  } catch (e) {
    console.error("Voice cleanup error:", e?.message || e);
  }
}

// --- OpenAI Chat + TTS ---
async function getLunaReply(userId, userMessage) {
  if (!memory[userId]) memory[userId] = [];
  memory[userId].push({ role: "user", content: userMessage });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are Luna, a helpful AI assistant." },
      ...memory[userId],
    ],
    max_tokens: 200,
  });

  const reply = response.choices[0].message.content;
  memory[userId].push({ role: "assistant", content: reply });
  saveMemory();
  return reply;
}

async function textToSpeech(text, filename) {
  const outputPath = path.join(voicesDir, filename);
  const mp3 = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return `/voices/${filename}`;
}

// --- Web Routes ---
app.post("/chat", async (req, res) => {
  const { userId, message } = req.body;
  try {
    const reply = await getLunaReply(userId, message);
    const voiceFile = `${uuidv4()}.mp3`;
    const voiceUrl = await textToSpeech(reply, voiceFile);
    res.json({ reply, voiceUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin routes
app.post("/admin/reset", (req, res) => {
  memory = {};
  saveMemory();
  res.json({ status: "All user memory cleared" });
});

app.get("/admin/users", (req, res) => {
  res.json({ users: Object.keys(memory) });
});

app.get("/admin/history/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({ history: memory[userId] || [] });
});

// --- Telegram Bot ---
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.start((ctx) => ctx.reply("Hi! I’m Luna. Talk to me!"));

  bot.on("text", async (ctx) => {
    const userId = ctx.from.id.toString();
    const message = ctx.message.text;

    const reply = await getLunaReply(userId, message);
    await ctx.reply(reply);

    // Send voice reply too
    const voiceFile = `${uuidv4()}.ogg`;
    const voiceUrl = await textToSpeech(reply, voiceFile);
    const fullAudioPath = path.join(__dirname, "public", voiceUrl);

    if (fs.existsSync(fullAudioPath)) {
      await ctx.replyWithVoice({ source: fullAudioPath });
      safeUnlink(fullAudioPath); // optional immediate cleanup
    }
  });

  bot.launch();
  console.log("✅ Telegram bot running");
}

// --- Startup ---
app.listen(PORT, () =>
  console.log(`🚀 Luna running on http://localhost:${PORT}`)
);

// Run cleanup
cleanupVoiceFiles();
setInterval(cleanupVoiceFiles, CLEANUP_INTERVAL_MS);
