// server.js
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(express.static("public")); // serve Web UI

// ✅ Load environment
const openaiKey = process.env.OPENAI_API_KEY;
const telegramToken = process.env.TELEGRAM_TOKEN;
const adminToken = process.env.ADMIN_TOKEN;
const PORT = process.env.PORT || 10000;

// ✅ Memory store
const MEMORY_FILE = "memory.json";
let memory = {};
if (fs.existsSync(MEMORY_FILE)) {
  memory = JSON.parse(fs.readFileSync(MEMORY_FILE));
}
function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ✅ OpenAI client
const openai = new OpenAI({ apiKey: openaiKey });

// ✅ Generate AI response
async function generateResponse(userId, message) {
  if (!memory[userId]) memory[userId] = [];
  memory[userId].push({ role: "user", content: message });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: memory[userId],
  });

  const reply = completion.choices[0].message.content;
  memory[userId].push({ role: "assistant", content: reply });
  saveMemory();

  return reply;
}

// ✅ Web UI route
app.post("/public-chat", async (req, res) => {
  const { userId, message } = req.body;
  try {
    const reply = await generateResponse(userId, message);
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).json({ error: "AI error" });
  }
});

// ✅ Reset endpoint (Web)
app.delete("/reset/:userId", (req, res) => {
  const userId = req.params.userId;
  delete memory[userId];
  saveMemory();
  res.json({ success: true, message: `Reset memory for ${userId}` });
});

// ✅ Debug /status endpoint
app.get("/status", (req, res) => {
  res.json({
    openai: openaiKey ? "✅ Loaded" : "❌ Missing",
    telegram: telegramToken ? "✅ Loaded" : "❌ Missing",
    adminToken: adminToken ? "✅ Loaded" : "❌ Missing",
    port: PORT,
    uptime: process.uptime().toFixed(2) + "s",
  });
});

// ✅ Telegram bot
if (telegramToken) {
  const bot = new Telegraf(telegramToken);

  bot.start((ctx) =>
    ctx.reply("👋 Hi, I’m Luna! Type anything to chat.\nUse /reset to clear memory.")
  );

  bot.help((ctx) =>
    ctx.reply("Commands:\n/reset → Clear your memory\n/status → Bot health\n/admin_reset <USER_ID> <ADMIN_TOKEN>")
  );

  bot.command("reset", (ctx) => {
    const userId = `tg_${ctx.chat.id}`;
    delete memory[userId];
    saveMemory();
    ctx.reply("✅ Your memory has been reset.");
  });

  bot.command("status", (ctx) => {
    ctx.reply(
      `Bot Status:\nOpenAI: ${openaiKey ? "✅" : "❌"}\nTelegram: ${
        telegramToken ? "✅" : "❌"
      }\nAdmin Token: ${adminToken ? "✅" : "❌"}\nUptime: ${process
        .uptime()
        .toFixed(2)}s`
    );
  });

  bot.command("admin_reset", (ctx) => {
    const parts = ctx.message.text.split(" ");
    if (parts.length !== 3) {
      return ctx.reply("❌ Usage: /admin_reset <USER_ID> <ADMIN_TOKEN>");
    }
    const [_, targetId, providedToken] = parts;
    if (providedToken !== adminToken) {
      return ctx.reply("❌ Invalid admin token.");
    }
    delete memory[targetId];
    saveMemory();
    ctx.reply(`✅ Memory reset for ${targetId}`);
  });

  bot.on("text", async (ctx) => {
    const userId = `tg_${ctx.chat.id}`;
    const message = ctx.message.text;
    try {
      const reply = await generateResponse(userId, message);
      ctx.reply(reply);
    } catch (err) {
      console.error("OpenAI error:", err);
      ctx.reply("❌ Sorry, I couldn’t process that.");
    }
  });

  bot.launch();
  console.log("🤖 Telegram bot started!");
}

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Luna Bot running on port ${PORT}`);
});
