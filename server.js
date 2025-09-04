import express from "express";
import rateLimit from "express-rate-limit";
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

// 🧠 Load memory
let memory = {};
if (fs.existsSync(memoryFile)) {
  memory = JSON.parse(fs.readFileSync(memoryFile));
}
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
}

// 🛡️ Rate Limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "⚠️ Too many requests, please slow down." },
});
app.use("/public-chat", limiter);

// ✨ Summarization
async function summarizeIfNeeded(userId) {
  if (memory[userId] && memory[userId].length > 20) {
    const summaryInput = memory[userId].slice(0, 15);
    try {
      const summaryResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Summarize this conversation briefly." },
          ...summaryInput,
        ],
      });
      const summary = summaryResp.choices[0].message.content;
      memory[userId] = [{ role: "system", content: `Summary: ${summary}` }].concat(
        memory[userId].slice(-5)
      );
      saveMemory();
    } catch (err) {
      console.error("Summarization failed:", err.message);
    }
  }
}

// 🔮 AI Response
async function getAIResponse(userId, message) {
  if (!process.env.OPENAI_API_KEY) return "❌ Missing OpenAI API key.";
  if (!memory[userId]) memory[userId] = [];
  memory[userId].push({ role: "user", content: message });

  await summarizeIfNeeded(userId);

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
    return "⚠️ Luna is having trouble connecting to AI.";
  }
}

// 🌐 Web Chat
app.post("/public-chat", async (req, res) => {
  const { userId, message } = req.body;

  // Image generation
  if (message.startsWith("/imagine ")) {
    try {
      const prompt = message.replace("/imagine ", "");
      const img = await openai.images.generate({ model: "gpt-image-1", prompt });
      return res.json({ reply: img.data[0].url });
    } catch (err) {
      return res.json({ reply: "⚠️ Failed to generate image." });
    }
  }

  // Voice shortcut
  if (message.startsWith("/voice ")) {
    try {
      const prompt = message.replace("/voice ", "");
      const speech = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: prompt,
      });
      const buffer = Buffer.from(await speech.arrayBuffer());
      const filename = `voice-${Date.now()}.mp3`;
      const filepath = `public/${filename}`;
      fs.writeFileSync(filepath, buffer);

      return res.json({ reply: "/" + filename, type: "audio" });
    } catch (err) {
      return res.json({ reply: "⚠️ Failed to generate voice." });
    }
  }

  const reply = await getAIResponse(userId, message);
  res.json({ reply, type: "text" });
});

// 🎙️ Voice endpoint (UI button)
app.post("/public-voice", async (req, res) => {
  const { userId, message } = req.body;
  try {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: message,
    });
    const buffer = Buffer.from(await speech.arrayBuffer());
    const filename = `voice-${Date.now()}.mp3`;
    const filepath = `public/${filename}`;
    fs.writeFileSync(filepath, buffer);

    res.json({ audioUrl: "/" + filename });
  } catch (err) {
    console.error("Voice error:", err.message);
    res.status(500).json({ error: "⚠️ Failed to generate voice reply." });
  }
});

// Reset (Web)
app.delete("/reset/:userId", (req, res) => {
  const { userId } = req.params;
  delete memory[userId];
  saveMemory();
  res.json({ success: true });
});

// 🩺 Status
app.get("/status", (req, res) => {
  res.json({
    openai: process.env.OPENAI_API_KEY ? "✅ Loaded" : "❌ Missing",
    telegram: process.env.TELEGRAM_TOKEN ? "✅ Loaded" : "❌ Missing",
    port: PORT,
    uptime: process.uptime().toFixed(2) + "s",
  });
});
// 📋 Admin: List active users
app.get("/admin/users", (req, res) => {
  res.json(Object.keys(memory));
});

// 📱 Telegram Bot
if (process.env.TELEGRAM_TOKEN) {
  const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

  bot.start((ctx) => ctx.reply("👋 Hello! I’m Luna. Type /help to see commands."));
  bot.help((ctx) =>
    ctx.reply("/help\n/reset\n/imagine <prompt>\n/voice <msg>\n/status")
  );

  bot.command("reset", (ctx) => {
    delete memory[ctx.from.id];
    saveMemory();
    ctx.reply("✅ Your memory has been reset.");
  });

  bot.command("imagine", async (ctx) => {
    const prompt = ctx.message.text.replace("/imagine ", "");
    try {
      const img = await openai.images.generate({ model: "gpt-image-1", prompt });
      ctx.replyWithPhoto(img.data[0].url);
    } catch {
      ctx.reply("⚠️ Failed to generate image.");
    }
  });

  bot.command("voice", async (ctx) => {
    const prompt = ctx.message.text.replace("/voice ", "") || "Hello from Luna!";
    try {
      const speech = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: prompt,
      });
      const buffer = Buffer.from(await speech.arrayBuffer());
      fs.writeFileSync("reply.ogg", buffer);
      await ctx.replyWithVoice({ source: "reply.ogg" });
    } catch {
      ctx.reply("⚠️ Failed to generate voice reply.");
    }
  });

  bot.on("text", async (ctx) => {
    const reply = await getAIResponse(ctx.from.id, ctx.message.text);
    ctx.reply(reply);
  });

  bot.launch();
  console.log("🤖 Telegram bot started!");
}

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`🚀 Luna Bot running on port ${PORT}`);
});
