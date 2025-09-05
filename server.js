import express from "express";
import bodyParser from "body-parser";
import { Telegraf } from "telegraf";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: "uploads/" });

app.use(bodyParser.json());
app.use(express.static("public"));

/* -------------------- OpenAI & Telegram -------------------- */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/* -------------------- In-Memory Chat Sessions -------------------- */
let sessions = {}; // { userId: [ {role, content}, ... ] }
let logs = [];

/* -------------------- Settings (config.json) -------------------- */
const CONFIG_PATH = path.join(__dirname, "config.json");
function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      personality: "friendly",
      rotation: { enabled: false, strategy: "sequential", time: "09:00", lastRotated: "" },
      rotationState: { index: 0 }
    };
  }
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}
let CONFIG = readConfig();

/* -------------------- Personality System Prompt -------------------- */
const PERSONALITIES = {
  friendly:
    "You are Luna, a warm, encouraging, and helpful AI companion. Be concise, kind, and practical.",
  formal:
    "You are Luna, a clear and professional assistant. Use polite, concise, and precise language.",
  playful:
    "You are Luna, witty and upbeat. Keep it light, positive, and fun while staying helpful.",
  tutor:
    "You are Luna, a patient teacher. Explain step by step, give examples, and check understanding.",
  gamer:
    "You are Luna, a gamer buddy. Use casual tone, analogies to games, and keep responses punchy."
};

function systemMessage() {
  const p = CONFIG.personality in PERSONALITIES ? CONFIG.personality : "friendly";
  return { role: "system", content: PERSONALITIES[p] };
}

/* -------------------- Utility: Avatar helpers -------------------- */
const PUBLIC_DIR = path.join(__dirname, "public");
const AVATARS_DIR = path.join(PUBLIC_DIR, "avatars");
const ACTIVE_AVATAR = path.join(PUBLIC_DIR, "luna_avatar.png");

function listAvatars() {
  if (!fs.existsSync(AVATARS_DIR)) return [];
  return fs
    .readdirSync(AVATARS_DIR)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();
}

function setActiveAvatarByName(filename) {
  const sourcePath = path.join(AVATARS_DIR, filename);
  if (!fs.existsSync(sourcePath)) throw new Error("Avatar not found");
  fs.copyFileSync(sourcePath, ACTIVE_AVATAR);
}

function rotateAvatarNow() {
  const avatars = listAvatars();
  if (avatars.length === 0) return { ok: false, reason: "No avatars found." };

  if (CONFIG.rotation.strategy === "random") {
    // choose different from current if possible
    const currentHash = fs.existsSync(ACTIVE_AVATAR)
      ? fs.readFileSync(ACTIVE_AVATAR).toString("base64").slice(0, 40)
      : "";
    let pick = avatars[Math.floor(Math.random() * avatars.length)];
    // try a few times to avoid choosing same image
    for (let i = 0; i < 5; i++) {
      const tmp = avatars[Math.floor(Math.random() * avatars.length)];
      const tmpHash = fs.readFileSync(path.join(AVATARS_DIR, tmp)).toString("base64").slice(0, 40);
      if (tmpHash !== currentHash) {
        pick = tmp;
        break;
      }
    }
    setActiveAvatarByName(pick);
    return { ok: true, pick };
  } else {
    // sequential
    const idx = CONFIG.rotationState?.index ?? 0;
    const pick = avatars[idx % avatars.length];
    setActiveAvatarByName(pick);
    CONFIG.rotationState = { index: (idx + 1) % avatars.length };
    writeConfig(CONFIG);
    return { ok: true, pick };
  }
}

/* -------------------- Scheduler: daily rotation -------------------- */
// Runs every 60s, rotates when local time matches configured "HH:MM" and not already done today
setInterval(() => {
  try {
    const { enabled, time } = CONFIG.rotation || {};
    if (!enabled || !time) return;
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5); // "HH:MM"
    const today = now.toISOString().slice(0, 10);
    if (hhmm === time && CONFIG.rotation.lastRotated !== today) {
      const result = rotateAvatarNow();
      CONFIG.rotation.lastRotated = today;
      writeConfig(CONFIG);
      console.log("🔄 Avatar rotation", result);
    }
  } catch (e) {
    console.error("Rotation error:", e.message);
  }
}, 60 * 1000);

/* -------------------- Web Chat Endpoint -------------------- */
app.post("/chat", async (req, res) => {
  const { user, message } = req.body || {};
  if (!user || !message) return res.status(400).json({ error: "Missing user or message" });

  if (!sessions[user]) sessions[user] = [systemMessage()];
  sessions[user].push({ role: "user", content: message });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: sessions[user]
    });

    const reply = response.choices?.[0]?.message?.content ?? "…";
    sessions[user].push({ role: "assistant", content: reply });
    logs.push({ user, message, reply, time: new Date().toISOString() });

    // (Optional) TTS audio (comment out if not using)
    let audioPath = "";
    try {
      const audioResp = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: reply
      });
      audioPath = `public/reply_${Date.now()}.mp3`;
      const buffer = Buffer.from(await audioResp.arrayBuffer());
      fs.writeFileSync(audioPath, buffer);
    } catch (e) {
      // non-fatal
      console.warn("TTS error (web):", e.message);
    }

    res.json({ reply, audio: audioPath ? audioPath.replace("public/", "") : "" });
  } catch (err)
