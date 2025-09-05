import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import multer from "multer";
import OpenAI from "openai";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static("public"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const conversations = {};
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "secret123";

// Model can be switched in .env
const MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";

// -------------
// SAFE WRAPPER
// -------------
async function safeChatCompletion(messages) {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
    });
    return completion.choices[0].message.content;
  } catch (err) {
    if (err.status === 429) {
      console.error("Rate limit hit:", err.message);
      return "⚠️ I’m overloaded right now. Please try again later.";
    }
    console.error("OpenAI error:", err);
    return "⚠️ Something went wrong with my brain. Try again later.";
  }
}

// -------------------
// --- WEB ROUTES ---
// -------------------

app.post("/chat", async (req, res) => {
  const { userId, message } = req.body;
  if (!conversations[userId]) conversations[userId] = [];

  conversations[userId].push({ role: "user", content: message });

  const reply = await safeChatCompletion([
    { role: "system", content: "You are Luna, a friendly AI assistant." },
    ...conversations[userId],
  ]);

  conversations[userId].push({ role: "assistant", content: reply });

  try {
    const filename = `voice_${uuidv4()}.mp3`;
    const filepath = path.join("public", filename);
    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: reply,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    res.json({ reply, voiceUrl: "/" + filename });
  } catch (err) {
    console.error("TTS error:", err);
    res.json({ reply });
  }
});

// Handle voice input upload
const upload = multer({ dest: "uploads/" });
app.post("/voice", upload.single("audio"), async (req, res) => {
  const userId = req.body.userId || uuidv4();
  if (!conversations[userId]) conversations[userId] = [];

  try {
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
    });

    const textInput = transcript.text;
    conversations[userId].push({ role: "user", content: textInput });

    const reply = await safeChatCompletion([
      { role: "system", content: "You are Luna, a friendly AI assistant." },
      ...conversations[userId],
    ]);
    conversations[userId].push({ role: "assistant", content: reply });

    const filename = `voice_${uuidv4()}.mp3`;
    const filepath = path.join("public", filename);
    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: reply,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    fs.unlinkSync(req.file.path); // cleanup uploaded file

    res.json({ transcript: textInput, reply, voiceUrl: "/" + filename });
  } catch (err) {
    console.error("Web voice error:", err);
    res.status(500).json({ error: "Voice processing failed." });
  }
});

// -----------------------
// --- TELEGRAM ROUTES ---
// -----------------------

bot.on("text", async (ctx) => {
  const userId = ctx.from.id.toString();
  const message = ctx.message.text;
  if (!conversations[userId]) conversations[userId] = [];

  conversations[userId].push({ role: "user", content: message });

  const reply = await safeChatCompletion([
    { role: "system", content: "You are Luna, a friendly AI assistant." },
    ...conversations[userId],
  ]);
  conversations[userId].push({ role: "assistant", content: reply });

  try {
    await ctx.reply(reply);

    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: reply,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const voiceFile = `voice_${uuidv4()}.ogg`;
    fs.writeFileSync(voiceFile, buffer);
    await ctx.replyWithVoice({ source: voiceFile });
    fs.unlinkSync(voiceFile);
  } catch (err) {
    console.error("Telegram TTS error:", err);
  }
});

// Voice messages
bot.on("voice", async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!conversations[userId]) conversations[userId] = [];

  try {
    const fileId = ctx.message.voice.file_id;
    const file = await ctx.telegram.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const response = await fetch(url);
    const oggBuffer = Buffer.from(await response.arrayBuffer());
    const oggPath = `voice_input_${uuidv4()}.ogg`;
    fs.writeFileSync(oggPath, oggBuffer);

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(oggPath),
      model: "whisper-1",
    });

    const textInput = transcript.text;
    conversations[userId].push({ role: "user", content: textInput });

    const reply = await safeChatCompletion([
      { role: "system", content: "You are Luna, a friendly AI assistant." },
      ...conversations[userId],
    ]);
    conversations[userId].push({ role: "assistant", content: reply });

    await ctx.reply(`🗣 You said: "${textInput}"\n\n💡 Luna: ${reply}`);

    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: reply,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const voiceFile = `voice_${uuidv4()}.ogg`;
    fs.writeFileSync(voiceFile, buffer);
    await ctx.replyWithVoice({ source: voiceFile });
    fs.unlinkSync(voiceFile);
    fs.unlinkSync(oggPath);
  } catch (err) {
    console.error("Telegram voice error:", err);
    ctx.reply("⚠️ Failed to process your voice message.");
  }
});

// -----------------------
// --- ADMIN DASHBOARD ---
// -----------------------
app.get("/admin/users", (req, res) => {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return res.status(403).json({ error: "Forbidden" });
  res.json({ users: Object.keys(conversations) });
});

app.get("/admin/history/:id", (req, res) => {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return res.status(403).json({ error: "Forbidden" });
  res.json({ history: conversations[req.params.id] || [] });
});

app.post("/admin/reset", (req, res) => {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return res.status(403).json({ error: "Forbidden" });
  Object.keys(conversations).forEach((u) => delete conversations[u]);
  res.json({ success: true });
});

// -----------------------
// --- START SERVICES ---
// -----------------------
app.listen(PORT, () =>
  console.log(`🌐 Web server running on http://localhost:${PORT}`)
);
bot.launch();
console.log("🤖 Telegram bot is running!");
