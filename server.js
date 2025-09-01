import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static("public"));

// ------------------ OpenAI Setup ------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ------------------ Memory ------------------
let memory = {};
const MEMORY_FILE = "memory.json";

if (fs.existsSync(MEMORY_FILE)) {
  memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ------------------ OpenAI Helper ------------------
async function getLunaReply(userId, message) {
  if (!memory[userId]) memory[userId] = [];

  memory[userId].push({ role: "user", content: message });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are Luna, a friendly and supportive AI assistant." },
      ...memory[userId],
    ],
  });

  const reply = completion.choices[0].message.content;

  memory[userId].push({ role: "assistant", content: reply });
  saveMemory();

  return reply;
}

// ------------------ API Routes ------------------

// Web chat
app.post("/public-chat", async (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message) return res.status(400).json({ error: "Missing user_id or message" });

  try {
    const reply = await getLunaReply(user_id, message);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get response" });
  }
});

// Get history
app.get("/history/:user_id", (req, res) => {
  const { user_id } = req.params;
  res.json({ history: memory[user_id] || [] });
});

// Reset user memory (Web UI)
app.delete("/reset/:user_id", (req, res) => {
  const { user_id } = req.params;
  if (memory[user_id]) {
    delete memory[user_id];
    saveMemory();
  }
  res.json({ success: true });
});

// ------------------ Telegram Bot ------------------
if (process.env.TELEGRAM_TOKEN) {
  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = "tg_" + chatId;
    const text = msg.text?.trim();

    // Help
    if (text === "/help") {
      return bot.sendMessage(chatId, "🤖 Luna Commands:\n/reset → Reset your chat\n/help → Show this help menu\n/admin_reset USERID ADMIN_TOKEN → Admin reset");
    }

    // User reset
    if (text === "/reset") {
      if (memory[userId]) {
        delete memory[userId];
        saveMemory();
      }
      return bot.sendMessage(chatId, "🗑 Chat history has been reset. Start fresh with Luna!");
    }

    // Admin reset any user
    if (text.startsWith("/admin_reset")) {
      const parts = text.split(" ");
      if (parts.length === 3) {
        const targetUser = parts[1].trim();
        const token = parts[2].trim();

        if (token !== process.env.ADMIN_TOKEN) {
          return bot.sendMessage(chatId, "❌ Invalid admin token.");
        }

        if (memory[targetUser]) {
          delete memory[targetUser];
          saveMemory();
        }
        return bot.sendMessage(chatId, `🗑 Admin reset: memory cleared for ${targetUser}`);
      } else {
        return bot.sendMessage(chatId, "❌ Usage: /admin_reset USERID TOKEN");
      }
    }

    // Normal chat
    try {
      const reply = await getLunaReply(userId, text);
      bot.sendMessage(chatId, reply);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Error: Luna is unavailable right now.");
    }
  });

  console.log("✅ Telegram bot connected");
}

// ------------------ Start Server ------------------
app.listen(PORT, () => {
  console.log(`✅ Luna is live at http://localhost:${PORT}`);
});
