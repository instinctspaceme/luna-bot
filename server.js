// Luna AI Companion Bot
// Node.js + Express + OpenAI + Telegram

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import OpenAI from "openai";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// --- Memory store (simple JSON per user) ---
const memoryFile = "memory.json";
let memory = {};
if (fs.existsSync(memoryFile)) {
  memory = JSON.parse(fs.readFileSync(memoryFile));
}
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}

// --- OpenAI setup (new v4 syntax) ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Persona prompt for Luna ---
const persona = `
You are Luna, a playful, supportive AI companion.
Rules:
- Always keep tone warm, fun, and a little flirty (PG-13 only).
- Do not produce explicit NSFW content.
- Respect user boundaries and safety.
- Keep conversations casual, supportive, and personal.
`;

// --- Chat handler ---
async function chatWithLuna(userId, message) {
  if (!memory[userId]) memory[userId] = [];

  memory[userId].push({ role: "user", content: message });

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: persona },
      ...memory[userId].slice(-10), // last 10 exchanges
    ],
  });

  const reply = response.choices[0].message.content.trim();
  memory[userId].push({ role: "assistant", content: reply });
  saveMemory();

  return reply;
}

// Public endpoint (no token required)
app.post("/public-chat", async (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message) {
    return res.status(400).json({ error: "Missing user_id or message" });
  }

  try {
    const reply = await chatWithLuna(user_id, message);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI error" });
  }
});
// --- Express API endpoint ---
app.post("/chat", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { user_id, message } = req.body;
  if (!user_id || !message) {
    return res.status(400).json({ error: "Missing user_id or message" });
  }

  try {
    const reply = await chatWithLuna(user_id, message);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI error" });
  }
});

// --- Telegram Bot Integration ---
if (process.env.TELEGRAM_TOKEN) {
  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = `tg_${chatId}`; // separate from web UI
    const reply = await chatWithLuna(userId, msg.text);
    bot.sendMessage(chatId, reply);
  });
}

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Luna is live on http://localhost:${PORT}`);
});
// Fetch conversation history for a user
app.get("/history/:user_id", (req, res) => {
  const { user_id } = req.params;
  if (!user_id) return res.status(400).json({ error: "Missing user_id" });

  const history = memory[user_id] || [];
  res.json({ history });
});
