import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(join(__dirname, "public")));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const memoryFile = join(__dirname, "memory.json");
let memory = fs.existsSync(memoryFile)
  ? JSON.parse(fs.readFileSync(memoryFile))
  : {};

function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}

// === Logging Setup ===
const logsDir = join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

function logMessage(userId, role, content) {
  const logFile = join(logsDir, `${userId}.log`);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${role.toUpperCase()}: ${content}\n`;
  fs.appendFileSync(logFile, line);
}

// === Core Chat Function ===
async function chatWithLuna(userId, message) {
  if (!memory[userId]) memory[userId] = { messages: [] };
  memory[userId].messages.push({ role: "user", content: message });
  logMessage(userId, "user", message);

  const messages = [
    { role: "system", content: "You are Luna, a friendly helpful AI assistant." },
    ...memory[userId].messages.slice(-10),
  ];

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  const reply = response.choices[0].message.content;
  memory[userId].messages.push({ role: "assistant", content: reply });
  logMessage(userId, "assistant", reply);

  saveMemory();
  return reply;
}

// === Web Chat API ===
app.post("/chat", async (req, res) => {
  try {
    const { userId, message } = req.body;
    const reply = await chatWithLuna(userId, message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Chat failed" });
  }
});

// === Admin Middleware ===
function checkAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// === Admin Routes ===
app.get("/status", checkAdmin, (req, res) => {
  res.json({ status: "ok", users: Object.keys(memory).length, uptime: process.uptime() });
});

app.get("/admin/users", checkAdmin, (req, res) => {
  res.json(Object.keys(memory));
});

app.delete("/reset/:userId", checkAdmin, (req, res) => {
  const { userId } = req.params;
  delete memory[userId];
  saveMemory();
  res.json({ success: true });
});

app.delete("/admin/reset-all", checkAdmin, (req, res) => {
  memory = {};
  saveMemory();
  res.json({ success: true });
});

// 📜 View chat history
app.get("/admin/history/:userId", checkAdmin, (req, res) => {
  const { userId } = req.params;
  if (!memory[userId]) return res.status(404).json({ error: "User not found" });
  res.json(memory[userId].messages || []);
});

// 📂 View logs
app.get("/admin/logs/:userId", checkAdmin, (req, res) => {
  const { userId } = req.params;
  const logFile = join(logsDir, `${userId}.log`);
  if (!fs.existsSync(logFile)) return res.status(404).send("No logs found.");
  const logs = fs.readFileSync(logFile, "utf8");
  res.type("text/plain").send(logs);
});

// 📥 Download logs as .txt
app.get("/admin/logs/:userId/download", checkAdmin, (req, res) => {
  const { userId } = req.params;
  const logFile = join(logsDir, `${userId}.log`);
  if (!fs.existsSync(logFile)) return res.status(404).send("No logs found.");

  res.setHeader("Content-Disposition", `attachment; filename="${userId}_logs.txt"`);
  res.setHeader("Content-Type", "text/plain");
  res.send(fs.readFileSync(logFile, "utf8"));
});

// === Telegram Bot ===
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  bot.start((ctx) => ctx.reply("Hi! I’m Luna 🤖. How can I help you today?"));
  bot.on("text", async (ctx) => {
    const userId = ctx.from.id.toString();
    const reply = await chatWithLuna(userId, ctx.message.text);
    ctx.reply(reply);
  });
  bot.launch();
  console.log("✅ Telegram bot running");
}

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
