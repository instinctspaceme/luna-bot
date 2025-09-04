import express from "express";
import bodyParser from "body-parser";
import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

// ================== Setup ==================
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(bodyParser.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ================== Memory ==================
let memory = {};
const memoryFile = path.join(__dirname, "memory.json");

function loadMemory() {
  if (fs.existsSync(memoryFile)) {
    try {
      memory = JSON.parse(fs.readFileSync(memoryFile, "utf-8"));
    } catch {
      memory = {};
    }
  }
}
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}
loadMemory();

// ================== Helpers ==================
async function chatWithLuna(userId, userMessage) {
  if (!memory[userId]) memory[userId] = { notes: [], messages: [] };

  memory[userId].messages.push({ role: "user", content: userMessage });
  if (memory[userId].messages.length > 20) {
    memory[userId].messages = memory[userId].messages.slice(-20);
  }

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Luna, a friendly AI assistant with memory." },
        ...memory[userId].messages,
      ],
    });

    const reply = completion.choices[0].message.content;
    memory[userId].messages.push({ role: "assistant", content: reply });
    saveMemory();
    return reply;
  } catch (err) {
    console.error("OpenAI Error:", err);
    return "⚠️ Sorry, I had a problem.";
  }
}

// ================== Telegram Bot ==================
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.start(ctx => ctx.reply("👋 Hi! I’m Luna. Let’s chat!"));
  bot.command("forget", ctx => {
    memory[ctx.from.id] = { notes: [], messages: [] };
    saveMemory();
    ctx.reply("🗑 Memory cleared!");
  });

  bot.on("text", async ctx => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const reply = await chatWithLuna(userId, text);
    ctx.reply(reply);
  });

  bot.launch();
  console.log("✅ Telegram bot running...");
}

// ================== Web Routes ==================
app.post("/chat", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: "Missing fields" });
  const reply = await chatWithLuna(userId, message);
  res.json({ reply });
});

app.delete("/reset/:userId", (req, res) => {
  const { userId } = req.params;
  delete memory[userId];
  saveMemory();
  res.json({ success: true });
});

app.get("/status", (req, res) => {
  res.json({
    uptime: process.uptime(),
    users: Object.keys(memory).length,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    openai: !!process.env.OPENAI_API_KEY,
  });
});

// ================== Admin Security ==================
function checkAdmin(req, res, next) {
  const token = req.query.token || req.headers["x-admin-token"];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "⛔ Unauthorized" });
  }
  next();
}

// Admin routes
app.get("/admin/users", checkAdmin, (req, res) => {
  res.json(Object.keys(memory));
});

app.delete("/admin/reset-all", checkAdmin, (req, res) => {
  memory = {};
  saveMemory();
  res.json({ success: true, message: "✅ All memories cleared." });
});

// ================== Start ==================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
