// server.js
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";
import multer from "multer";
import pdf from "pdf-parse";
import OpenAI from "openai";
import { Telegraf } from "telegraf";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ensure folders
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
const voicesDir = path.join(__dirname, "public", "voices");
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir);

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Storage & memory
const memoryFile = path.join(__dirname, "memory.json");
let memory = {};
if (fs.existsSync(memoryFile)) {
  try { memory = JSON.parse(fs.readFileSync(memoryFile, "utf8")); } catch { memory = {}; }
}
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}

// Logging helper
function logMessage(userId, role, content) {
  const logFile = path.join(logsDir, `${userId}.log`);
  const time = new Date().toISOString();
  fs.appendFileSync(logFile, `[${time}] ${role.toUpperCase()}: ${content}\n`);
}

// Ensure user structure
function ensureUser(userId) {
  if (!memory[userId]) memory[userId] = { messages: [], notes: "" };
}

// Summarization to bound memory (simple)
async function summarizeIfNeeded(userId) {
  const msgs = memory[userId].messages;
  if (msgs.length <= 40) return;
  const toSummarize = msgs.slice(0, msgs.length - 20);
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Summarize the following conversation into a short context string for future replies." },
        ...toSummarize
      ],
    });
    const summary = resp.choices?.[0]?.message?.content || "";
    memory[userId].messages = [{ role: "system", content: `SUMMARY: ${summary}` }, ...msgs.slice(-20)];
    saveMemory();
  } catch (e) {
    console.error("Summarize error:", e?.message || e);
  }
}

// Core chat function
async function chatWithLuna(userId, userMessage, options = {}) {
  ensureUser(userId);
  // record user message
  memory[userId].messages.push({ role: "user", content: userMessage });
  logMessage(userId, "user", userMessage);

  await summarizeIfNeeded(userId);

  const systemPrompt = `You are Luna, a friendly virtual assistant. Use friendly, helpful tone unless user requests otherwise. Use any long-term notes if present. Reply in the same language as the user's message.`;
  const messages = [{ role: "system", content: systemPrompt }, ...memory[userId].messages];

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });
    const reply = resp.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply.";
    memory[userId].messages.push({ role: "assistant", content: reply });
    logMessage(userId, "assistant", reply);
    saveMemory();
    return reply;
  } catch (err) {
    console.error("OpenAI chat error:", err?.message || err);
    return "⚠️ Error connecting to AI.";
  }
}

// ---------- TTS (server-side) ----------
async function synthesizeVoice(text) {
  // Use OpenAI TTS endpoint
  // Returns relative URL to saved file in /public/voices
  try {
    const resp = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
    });
    // resp is a stream/ArrayBuffer - convert to buffer
    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const filename = `voice-${Date.now()}.mp3`;
    const filepath = path.join(voicesDir, filename);
    fs.writeFileSync(filepath, buffer);
    return `/voices/${filename}`;
  } catch (e) {
    console.error("TTS error:", e?.message || e);
    throw e;
  }
}

// ---------- Upload parsing (PDF/TXT) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------- Web endpoints ----------

// POST /public-chat  { userId, message }
// handles normal chat, /imagine and /voice shortcuts (text->TTS)
app.post("/public-chat", async (req, res) => {
  try {
    const { userId, message } = req.body || {};
    if (!userId || !message) return res.status(400).json({ error: "userId and message required" });

    // /imagine -> image generation
    if (message.startsWith("/imagine ")) {
      const prompt = message.replace("/imagine ", "");
      try {
        const img = await openai.images.generate({ model: "gpt-image-1", prompt, size: "1024x1024" });
        const url = img.data?.[0]?.url || img.data?.[0]?.b64_json ? `data:image/png;base64,${img.data[0].b64_json}` : null;
        return res.json({ reply: url || "⚠️ Image generation failed", type: "image" });
      } catch (e) {
        console.error("Image error:", e?.message || e);
        return res.json({ reply: "⚠️ Image generation failed" });
      }
    }

    // /voice <text> -> return audio URL
    if (message.startsWith("/voice ")) {
      const text = message.replace("/voice ", "");
      try {
        const audioUrl = await synthesizeVoice(text);
        return res.json({ reply: audioUrl, type: "audio" });
      } catch {
        return res.json({ reply: "⚠️ Voice generation failed" });
      }
    }

    // normal chat
    const reply = await chatWithLuna(userId, message);
    res.json({ reply, type: "text" });
  } catch (err) {
    console.error("public-chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /public-voice -> generate TTS for arbitrary text (used by UI 'Voice Reply' button)
app.post("/public-voice", async (req, res) => {
  try {
    const { userId, message } = req.body || {};
    if (!userId || !message) return res.status(400).json({ error: "userId and message required" });
    const audioUrl = await synthesizeVoice(message);
    res.json({ audioUrl });
  } catch (e) {
    console.error("public-voice error:", e);
    res.status(500).json({ error: "Voice generation failed" });
  }
});

// POST /upload file (txt/pdf)
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!req.file) return res.status(400).json({ error: "file required" });

    let text = "";
    if (req.file.mimetype === "text/plain") {
      text = req.file.buffer.toString("utf8");
    } else if (req.file.mimetype === "application/pdf") {
      const data = await pdf(req.file.buffer);
      text = data.text || "";
    } else {
      return res.status(400).json({ error: "Only TXT or PDF supported" });
    }

    ensureUser(userId);
    const snippet = text.slice(0, 10000);
    memory[userId].messages.push({ role: "user", content: `<<DOCUMENT UPLOAD START>>\n${snippet}\n<<DOCUMENT UPLOAD END>>` });
    saveMemory();
    logMessage(userId, "system", `Uploaded file added (${req.file.originalname})`);
    res.json({ success: true, charsAdded: snippet.length });
  } catch (e) {
    console.error("upload error:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Admin middleware
function checkAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: "Forbidden" });
  next();
}

// admin routes
app.get("/status", checkAdmin, (req, res) => {
  res.json({
    openai: process.env.OPENAI_API_KEY ? "✅" : "❌",
    telegram: process.env.TELEGRAM_BOT_TOKEN ? "✅" : "❌",
    users: Object.keys(memory).length,
    uptime: process.uptime().toFixed(2) + "s"
  });
});

app.get("/admin/users", checkAdmin, (req, res) => res.json(Object.keys(memory)));
app.get("/admin/history/:userId", checkAdmin, (req, res) => {
  const { userId } = req.params;
  if (!memory[userId]) return res.status(404).json({ error: "Not found" });
  res.json(memory[userId].messages || []);
});
app.get("/admin/logs/:userId", checkAdmin, (req, res) => {
  const { userId } = req.params;
  const f = path.join(logsDir, `${userId}.log`);
  if (!fs.existsSync(f)) return res.status(404).send("No logs");
  res.type("text/plain").send(fs.readFileSync(f, "utf8"));
});
app.get("/admin/logs/:userId/download", checkAdmin, (req, res) => {
  const { userId } = req.params;
  const f = path.join(logsDir, `${userId}.log`);
  if (!fs.existsSync(f)) return res.status(404).send("No logs");
  res.setHeader("Content-Disposition", `attachment; filename="${userId}_logs.txt"`);
  res.type("text/plain").send(fs.readFileSync(f, "utf8"));
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

// ---------- Telegram: voice transcribe & TTS reply ----------
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  // helper to download file
  async function downloadFile(url) {
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    return buf;
  }

  bot.start((ctx) => ctx.reply("👋 Hi — I’m Luna. Send a message or a voice note."));

  // handle text
  bot.on("text", async (ctx) => {
    const uid = `tg_${ctx.from.id}`;
    const reply = await chatWithLuna(uid, ctx.message.text);
    await ctx.reply(reply);
  });

  // handle voice messages (ogg voice)
  bot.on("voice", async (ctx) => {
    try {
      const fileId = ctx.message.voice.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const buf = await downloadFile(fileLink.href);

      // save temporary file
      const tmpName = path.join(__dirname, `tmp_${Date.now()}.oga`);
      fs.writeFileSync(tmpName, buf);

      // transcribe via OpenAI Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpName),
        model: "whisper-1",
      });
      fs.unlinkSync(tmpName);

      const userText = transcription.text || "";
      const uid = `tg_${ctx.from.id}`;
      // get chat reply
      const replyText = await chatWithLuna(uid, userText);

      // synthesize reply audio
      const audioUrl = await synthesizeVoice(replyText);
      // send text and voice back
      await ctx.reply(`🗣 You said: ${userText}`);
      // download the generated audio from our public folder and send as voice
      const fullAudioPath = path.join(__dirname, "public", audioUrl.replace(/^\//, ""));
      if (fs.existsSync(fullAudioPath)) {
        await ctx.replyWithVoice({ source: fullAudioPath });
      } else {
        // fallback to sending text if audio file missing
        await ctx.reply(replyText);
      }
    } catch (e) {
      console.error("Telegram voice error:", e);
      await ctx.reply("⚠️ Could not process voice note.");
    }
  });

  // handle documents (txt/pdf) - add to memory
  bot.on("document", async (ctx) => {
    try {
      const doc = ctx.message.document;
      const url = await ctx.telegram.getFileLink(doc.file_id);
      const buf = Buffer.from(await (await fetch(url.href)).arrayBuffer());
      let text = "";
      if (doc.mime_type === "text/plain") text = buf.toString("utf8");
      else if (doc.mime_type === "application/pdf") {
        const data = await pdf(buf);
        text = data.text || "";
      } else {
        return ctx.reply("Only TXT or PDF supported.");
      }
      const uid = `tg_${ctx.from.id}`;
      ensureUser(uid);
      memory[uid].messages.push({ role: "user", content: `<<DOCUMENT>>\n${text.slice(0, 10000)}` });
      saveMemory();
      logMessage(uid, "system", `Document added (${doc.file_name})`);
      ctx.reply("✅ Document added to context. Ask me about it.");
    } catch (e) {
      console.error("Telegram doc error:", e);
      ctx.reply("⚠️ Failed to process document.");
    }
  });

  await bot.launch();
  console.log("🤖 Telegram bot started.");
}

// start server
app.listen(PORT, () => {
  console.log(`🚀 Luna server listening on http://localhost:${PORT} (PORT ${PORT})`);
  console.log("🔑 Environment check:", {
    openai: !!process.env.OPENAI_API_KEY,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    admin: !!process.env.ADMIN_TOKEN,
  });
});
