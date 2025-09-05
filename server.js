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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// -------- Memory Storage --------
let sessions = {};
let logs = [];

// -------- Web Chat Endpoint --------
app.post("/chat", async (req, res) => {
  const { user, message } = req.body;
  if (!sessions[user]) sessions[user] = [];

  sessions[user].push({ role: "user", content: message });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: sessions[user],
    });

    const reply = response.choices[0].message.content;
    sessions[user].push({ role: "assistant", content: reply });

    logs.push({ user, message, reply, time: new Date() });

    res.json({ reply });
  } catch (err) {
    console.error("OpenAI Error:", err);
    res.status(500).send("OpenAI API error.");
  }
});

// -------- Telegram Bot --------
bot.start(async (ctx) => {
  try {
    await ctx.replyWithPhoto(
      { source: "public/luna_avatar.png" },
      { caption: "🌙 Hi, I’m Luna — your AI assistant!" }
    );
  } catch (err) {
    console.error("Telegram Error:", err);
  }
});

bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  if (!sessions[userId]) sessions[userId] = [];

  sessions[userId].push({ role: "user", content: ctx.message.text });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: sessions[userId],
    });

    const reply = response.choices[0].message.content;
    sessions[userId].push({ role: "assistant", content: reply });

    logs.push({ user: userId, message: ctx.message.text, reply, time: new Date() });

    await ctx.reply(reply);
  } catch (err) {
    console.error("Telegram Reply Error:", err);
    await ctx.reply("⚠️ Sorry, I had trouble replying.");
  }
});

bot.launch();

// -------- Admin Routes --------
app.get("/sessions", (req, res) => res.json(sessions));
app.get("/logs", (req, res) => res.json(logs));

app.post("/reset/:user", (req, res) => {
  const user = req.params.user;
  delete sessions[user];
  res.send(`✅ Session reset for ${user}`);
});

// -------- Avatar Upload --------
app.post("/upload-avatar", upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");

  const newPath = path.join(__dirname, "public", "luna_avatar.png");

  fs.rename(req.file.path, newPath, (err) => {
    if (err) {
      console.error("Error saving avatar:", err);
      return res.status(500).send("Failed to update avatar.");
    }
    res.send("✅ Avatar updated successfully!");
  });
});

// -------- Start Server --------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
