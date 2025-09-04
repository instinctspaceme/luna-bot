import express from "express";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import multer from "multer";
import pdf from "pdf-parse";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;
const openaiKey = process.env.OPENAI_API_KEY;
const telegramToken = process.env.TELEGRAM_TOKEN;
const adminToken = process.env.ADMIN_TOKEN;

const openai = new OpenAI({ apiKey: openaiKey });

// ====== PERSISTENT STATE ======
const STORE_FILE = "memory.json";
let store = {
  messages: {},      // { userId: [ {role, content}, ... ] }
  modes: {},         // { userId: 'friendly' | 'teacher' | 'sarcastic' | 'professional' }
  notes: {}          // { userId: 'long term notes text' }
};

if (fs.existsSync(STORE_FILE)) {
  try { store = JSON.parse(fs.readFileSync(STORE_FILE)); } catch {}
}
function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
function ensureUser(userId) {
  if (!store.messages[userId]) store.messages[userId] = [];
  if (!store.modes[userId]) store.modes[userId] = "friendly";
  if (!store.notes[userId]) store.notes[userId] = "";
}
function resetUser(userId) {
  delete store.messages[userId];
  delete store.modes[userId];
  delete store.notes[userId];
  saveStore();
}

// ====== AI CORE ======
const MODE_PROMPTS = {
  friendly: "Be warm, upbeat, concise, and helpful.",
  teacher: "Be patient, structured, and explain step-by-step like a great teacher.",
  sarcastic: "Be witty and lightly sarcastic but never rude; still be helpful.",
  professional: "Be formal, efficient, and businesslike."
};

async function generateReply(userId, userMessage, opts = {}) {
  ensureUser(userId);

  // Update mode if passed
  if (opts.mode && MODE_PROMPTS[opts.mode]) {
    store.modes[userId] = opts.mode;
    saveStore();
  }

  const mode = store.modes[userId];
  const notes = store.notes[userId] || "";

  // System prompt guides language + persona + notes usage
  const systemPrompt =
    `You are Luna, an AI assistant. ${MODE_PROMPTS[mode]}\n` +
    `Always reply in the same language as the user's latest message.\n` +
    (notes ? `User long-term notes (use for personalization when relevant): ${notes}\n` : "");

  const history = store.messages[userId] || [];
  history.push({ role: "user", content: userMessage });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...history],
    });

    const reply = completion.choices[0]?.message?.content ?? "…";
    history.push({ role: "assistant", content: reply });
    store.messages[userId] = history;
    saveStore();
    return reply;
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return "⚠️ Error connecting to AI.";
  }
}

// ====== WEB API ======
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Chat
app.post("/public-chat", async (req, res) => {
  const { userId, message, mode } = req.body || {};
  if (!openaiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  if (!userId || !message) return res.status(400).json({ error: "userId and message required" });

  const reply = await generateReply(userId, message, { mode });
  res.json({ reply, mode: store.modes[userId] });
});

// Set mode
app.post("/setmode", (req, res) => {
  const { userId, mode } = req.body || {};
  if (!userId || !mode || !MODE_PROMPTS[mode]) {
    return res.status(400).json({ error: "Valid userId and mode required" });
  }
  ensureUser(userId);
  store.modes[userId] = mode;
  saveStore();
  res.json({ success: true, mode });
});

// Add long-term note
app.post("/note", (req, res) => {
  const { userId, note } = req.body || {};
  if (!userId || !note) return res.status(400).json({ error: "userId and note required" });
  ensureUser(userId);
  store.notes[userId] = (store.notes[userId] || "") + (store.notes[userId] ? "\n" : "") + note;
  saveStore();
  res.json({ success: true });
});

// Upload (TXT/PDF)
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!req.file) return res.status(400).json({ error: "file required" });

    ensureUser(userId);

    let text = "";
    if (req.file.mimetype === "text/plain") {
      text = req.file.buffer.toString("utf8");
    } else if (req.file.mimetype === "application/pdf") {
      const data = await pdf(req.file.buffer);
      text = data.text || "";
    } else {
      return res.status(400).json({ error: "Only TXT or PDF supported" });
    }

    // Cap to avoid huge histories
    const snippet = text.slice(0, 8000);
    store.messages[userId].push({
      role: "user",
      content: `<<DOCUMENT CONTENT START>>\n${snippet}\n<<DOCUMENT CONTENT END>>`
    });
    saveStore();

    res.json({ success: true, charsAdded: snippet.length });
  } catch (e) {
    console.error("Upload error:", e);
    res.status(500).json({ error: "Upload/parse failed" });
  }
});

// Reset (Web)
app.delete("/reset/:userId", (req, res) => {
  const { userId } = req.params;
  resetUser(userId);
  res.json({ success: true });
});

// Status
app.get("/status", (req, res) => {
  res.json({
    openai: openaiKey ? "✅ Loaded" : "❌ Missing",
    telegram: telegramToken ? "✅ Loaded" : "❌ Missing",
    adminToken: adminToken ? "✅ Loaded" : "❌ Missing",
    port: PORT,
    usersTracked: Object.keys(store.messages).length,
    uptime: process.uptime().toFixed(2) + "s",
  });
});

// Simple Admin dashboard (read-only + reset buttons)
app.get("/admin", (req, res) => {
  const token = req.query.token;
  if (token !== adminToken) return res.status(403).send("Forbidden");

  const rows = Object.keys(store.messages).map(uid => {
    const count = store.messages[uid].length;
    const mode = store.modes[uid] || "friendly";
    const noteLines = (store.notes[uid] || "").split("\n").length;
    return `<tr>
      <td>${uid}</td>
      <td>${mode}</td>
      <td>${count}</td>
      <td>${noteLines}</td>
      <td><form method="POST" action="/admin/reset?token=${encodeURIComponent(token)}">
        <input type="hidden" name="userId" value="${uid}" />
        <button>Reset</button>
      </form></td>
    </tr>`;
  }).join("");

  const html = `
  <!doctype html><html><head><meta charset="utf-8"><title>Luna Admin</title>
  <style>body{font-family:sans-serif;padding:20px} table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:8px;text-align:left} button{padding:6px 10px}</style></head>
  <body>
    <h2>🌙 Luna Admin</h2>
    <p>Users: ${Object.keys(store.messages).length}</p>
    <table>
      <thead><tr><th>User</th><th>Mode</th><th>Msgs</th><th>Notes (lines)</th><th>Action</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='5'>No users yet</td></tr>"}</tbody>
    </table>
  </body></html>`;
  res.send(html);
});
app.post("/admin/reset", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (token !== adminToken) return res.status(403).send("Forbidden");
  const { userId } = req.body || {};
  if (userId) resetUser(userId);
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

// ====== TELEGRAM BOT ======
if (telegramToken) {
  const bot = new Telegraf(telegramToken);

  bot.start((ctx) =>
    ctx.reply("👋 Hi, I’m Luna! Type anything to chat.\nCommands: /help, /reset, /status, /setmode <friendly|teacher|sarcastic|professional>, /about")
  );

  bot.help((ctx) =>
    ctx.reply("Commands:\n/reset → clear your memory\n/status → bot health\n/setmode <friendly|teacher|sarcastic|professional>\n/about → about Luna\n/admin_reset <USER_ID> <ADMIN_TOKEN>")
  );

  bot.command("about", (ctx) =>
    ctx.reply("I’m Luna — an AI assistant. I remember context per user, support voice notes, multiple languages, and documents.")
  );

  bot.command("status", (ctx) =>
    ctx.reply(
      `OpenAI: ${openaiKey ? "✅" : "❌"}\nTelegram: ✅\nUsers tracked: ${Object.keys(store.messages).length}\nUptime: ${process.uptime().toFixed(2)}s`
    )
  );

  bot.command("reset", (ctx) => {
    const userId = `tg_${ctx.chat.id}`;
    resetUser(userId);
    ctx.reply("✅ Your memory has been reset.");
  });

  bot.command("setmode", (ctx) => {
    const parts = (ctx.message.text || "").split(/\s+/);
    const mode = parts[1];
    if (!MODE_PROMPTS[mode]) return ctx.reply("Use one: friendly, teacher, sarcastic, professional");
    const userId = `tg_${ctx.chat.id}`;
    ensureUser(userId);
    store.modes[userId] = mode;
    saveStore();
    ctx.reply(`✅ Mode set to: ${mode}`);
  });

  bot.command("admin_reset", (ctx) => {
    const parts = (ctx.message.text || "").split(" ");
    if (parts.length < 3) return ctx.reply("Usage: /admin_reset <USER_ID> <ADMIN_TOKEN>");
    const [_, targetId, provided] = parts;
    if (provided !== adminToken) return ctx.reply("❌ Invalid admin token.");
    resetUser(targetId);
    ctx.reply(`✅ Memory reset for ${targetId}`);
  });

  // Voice notes → transcribe with Whisper → reply
  bot.on("voice", async (ctx) => {
    try {
      const fileId = ctx.message.voice.file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      const resp = await fetch(link.href);
      const arrayBuf = await resp.arrayBuffer();
      const tmpPath = path.join(process.cwd(), `tmp_${Date.now()}.ogg`);
      fs.writeFileSync(tmpPath, Buffer.from(arrayBuf));

      const transcriptRes = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: "whisper-1"
      });
      fs.unlinkSync(tmpPath);

      const text = transcriptRes.text || "…";
      const userId = `tg_${ctx.chat.id}`;
      const reply = await generateReply(userId, text);
      await ctx.reply(`🗣️ You said: ${text}`);
      await ctx.reply(reply);
    } catch (e) {
      console.error("Voice error:", e);
      ctx.reply("⚠️ Could not transcribe that voice note.");
    }
  });

  // Documents (txt/pdf) → add to memory
  bot.on("document", async (ctx) => {
    try {
      const doc = ctx.message.document;
      const mime = doc.mime_type || "";
      if (!/^(text\/plain|application\/pdf)$/.test(mime)) {
        return ctx.reply("Only TXT or PDF are supported.");
      }
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const resp = await fetch(link.href);
      const buf = Buffer.from(await resp.arrayBuffer());

      let text = "";
      if (mime === "text/plain") text = buf.toString("utf8");
      else if (mime === "application/pdf") {
        const data = await pdf(buf);
        text = data.text || "";
      }

      const userId = `tg_${ctx.chat.id}`;
      ensureUser(userId);
      store.messages[userId].push({ role: "user", content: `<<DOCUMENT CONTENT START>>\n${text.slice(0, 8000)}\n<<DOCUMENT CONTENT END>>` });
      saveStore();

      ctx.reply("✅ Document added to context. Ask me questions about it!");
    } catch (e) {
      console.error("Doc error:", e);
      ctx.reply("⚠️ Could not process that file.");
    }
  });

  // Plain text
  bot.on("text", async (ctx) => {
    const userId = `tg_${ctx.chat.id}`;
    const message = ctx.message.text;
    const reply = await generateReply(userId, message);
    ctx.reply(reply);
  });

  bot.launch();
  console.log("🤖 Telegram bot started!");
}

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`🚀 Luna Bot running on port ${PORT}`);
  console.log("🔑 Environment check:");
  console.log("OPENAI_API_KEY:", openaiKey ? "✅" : "❌");
  console.log("TELEGRAM_TOKEN:", telegramToken ? "✅" : "❌");
  console.log("ADMIN_TOKEN:", adminToken ? "✅" : "❌");
});
