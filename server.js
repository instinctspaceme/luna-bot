import express from "express";
import { Telegraf } from "telegraf";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const memoryFile = "memory.json";

// 🧠 Load memory if exists
let memory = {};
if (fs.existsSync(memoryFile)) {
  memory = JSON.parse(fs.readFileSync(memoryFile));
}
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}

// 🔮 AI Response
async function getAIResponse(userId, message) {
  if (!process.env.OPENAI_API_KEY) return "❌ Missing OpenAI API key.";
  if (!memory[userId]) memory[userId] = [];
  memory[userId].push({ role: "user", content: message });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: memory[userId],
    });

    const reply = response.choices[0].message.content;
    memory[userId].push({ role: "assistant", content: reply });
    saveMemory();
    return reply;
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return "⚠️ Error connecting to AI.";
  }
}

// 🌐 Web UI route
app.post("/public-chat", async (req, res) => {
  const { userId, message } = req.body;
  const reply = await getAIResponse(userId, message);
  res.json({ reply });
});

// Reset (Web)
app.delete("/reset/:userId", (req, res) => {
  const { userId } = req.params;
  delete memory[userId];
  saveMemory();
  res.json({ success: true });
});

// 🔑 Admin reset
app.post("/admin_reset", (req, res) => {
  const { targetUserId, token } = req.body;
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  delete memory[targetUserId];
  saveMemory();
  res.json({ success: true });
});

// 🩺 Status check
app.get("/status", (req, res) => {
  res.json({
    openai: process.env.OPENAI_API_KEY ? "✅ Loaded" : "❌ Missing",
    telegram: process.env.TELEGRAM_TOKEN ? "✅ Loaded" : "❌ Missing",
    adminToken: process.env.ADMIN_TOKEN ? "✅ Loaded" : "❌ Missing",
    port: PORT,
    uptime: process.uptime().toFixed(2) + "s",
  });
});

// 📱 Telegram setup
if (process.env.TELEGRAM_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

  bot.start((ctx) => ctx.reply("👋 Hello! I’m Luna. Type /help to see commands."));
  bot.help((ctx) =>
    ctx.reply("/help - commands\n/reset - clear your memory\n/status - bot health\n/admin_reset <USER_ID> <TOKEN>")
  );

  bot.command("reset", (ctx) => {
    delete memory[ctx.from.id];
    saveMemory();
    ctx.reply("✅ Your memory has been reset.");
  });

  bot.command("status", (ctx) => {
    ctx.reply(
      `OpenAI: ${process.env.OPENAI_API_KEY ? "✅" : "❌"}\nTelegram: ✅\nUptime: ${process.uptime().toFixed(2)}s`
    );
  });

  bot.command("admin_reset", (ctx) => {
    const parts = ctx.message.text.split(" ");
    if (parts.length < 3) return ctx.reply("Usage: /admin_reset <USER_ID> <TOKEN>");
    const [_, userId, token] = parts;
    if (token !== process.env.ADMIN_TOKEN) return ctx.reply("❌ Invalid admin token.");
    delete memory[userId];
    saveMemory();
    ctx.reply(`✅ Reset memory for user ${userId}`);
  });

  bot.on("text", async (ctx) => {
    const reply = await getAIResponse(ctx.from.id, ctx.message.text);
    ctx.reply(reply);
  });

  bot.launch();
  console.log("🤖 Telegram bot started!");
}

// 🚀 Start Web server
app.listen(PORT, () => {
  console.log(`🚀 Luna Bot running on port ${PORT}`);
});
