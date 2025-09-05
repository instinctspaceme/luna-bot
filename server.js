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

    // Generate TTS audio
    const audioResp = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: reply,
    });

    const audioFile = `public/reply_${Date.now()}.mp3`;
    const buffer = Buffer.from(await audioResp.arrayBuffer());
    fs.writeFileSync(audioFile, buffer);

    res.json({ reply, audio: audioFile.replace("public/", "") });
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
      { caption: "🌙 Hi, I’m Luna — your AI companion!" }
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

    // Send text
    await ctx.reply(reply);

    // Send voice
    const audioResp = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: reply,
    });

    const audioFile = `reply_${Date.now()}.ogg`;
    const buffer = Buffer.from(await audioResp.arrayBuffer());
    fs.writeFileSync(audioFile, buffer);
    await ctx.replyWithVoice({ source: audioFile });
  } catch (err) {
    console.error("Telegram Reply Error:", err);
    await ctx.reply("⚠️ Sorry, I had trouble replying.");
  }
});

// -------- Avatar Gallery --------
app.get("/avatars", (req, res) => {
  const avatarsPath = path.join(__dirname, "public", "avatars");
  fs.readdir(avatarsPath, (err, files) => {
    if (err) return res.status(500).send("Error loading avatars.");
    res.json(files);
  });
});

app.post("/set-avatar/:name", (req, res) => {
  const avatarName = req.params.name;
  const sourcePath = path.join(__dirname, "public", "avatars", avatarName);
  const targetPath = path.join(__dirname, "public", "luna_avatar.png");

  if (!fs.existsSync(sourcePath)) return res.status(404).send("Avatar not found.");

  fs.copyFileSync(sourcePath, targetPath);
  res.send(`✅ Avatar switched to ${avatarName}`);
});

// -------- Telegram Webhook Setup --------
app.use(bot.webhookCallback("/telegram-webhook"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  // Set webhook on startup
  if (process.env.RENDER_EXTERNAL_URL) {
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/telegram-webhook`;
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`✅ Telegram webhook set: ${webhookUrl}`);
    } catch (err) {
      console.error("Failed to set Telegram webhook:", err);
    }
  }
});
