// Luna Bot — rollback baseline (no TTS)
// Web UI + Telegram (webhook) + avatar expressions + simple admin.

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import Sentiment from "sentiment";
import { Telegraf } from "telegraf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const sentiment = new Sentiment();

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

/* -------------------- CONFIG -------------------- */
const configPath = path.join(__dirname, "config.json");
let config = {
  globalAvatar: "luna1.png",
  background: "default.jpg",
  expressions: {
    happy: "luna_happy.png",
    sad: "luna_sad.png",
    neutral: "luna1.png"
  }
};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error("Failed to parse config.json; using defaults:", e.message);
  }
}
const saveConfig = () =>
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

/* -------------------- HELPERS -------------------- */
function listImageFiles(absDir) {
  if (!fs.existsSync(absDir)) return [];
  try {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.(png|jpe?g|gif|webp)$/i.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/* -------------------- ROUTES -------------------- */
app.get("/healthz", (_, res) => res.send("ok"));

app.get("/config", (_, res) => res.json(config));

app.post("/config", (req, res) => {
  try {
    config = { ...config, ...req.body };
    // protect expressions shape
    if (req.body.expressions) {
      config.expressions = {
        ...config.expressions,
        ...req.body.expressions,
      };
    }
    saveConfig();
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* List avatars from /public/avatars and /public (mobile friendly) */
app.get("/avatars", (_, res) => {
  const avatarsDir = path.join(__dirname, "public", "avatars");
  const publicDir = path.join(__dirname, "public");

  const fromAvatars = listImageFiles(avatarsDir).map((f) => `avatars/${f}`);
  const fromPublic = listImageFiles(publicDir);

  const unique = Array.from(new Set([...fromAvatars, ...fromPublic]));
  res.json(unique);
});

/* Basic chat route: returns reply + suggested expression based on sentiment */
app.post("/api/chat", (req, res) => {
  const { message = "" } = req.body || {};
  const result = sentiment.analyze(message);

  let expression = config.expressions.neutral;
  if (result.score >= 2) expression = config.expressions.happy;
  else if (result.score <= -2) expression = config.expressions.sad;

  // Simple canned reply (you can replace with an LLM later)
  const reply =
    result.score >= 2
      ? "I love your energy! 😊"
      : result.score <= -2
      ? "I’m here with you. 💜"
      : "I’m listening.";

  res.json({ reply, expression });
});

/* -------------------- TELEGRAM (WEBHOOK) -------------------- */
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PUBLIC_URL =
  process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "";

if (TELEGRAM_TOKEN) {
  const bot = new Telegraf(TELEGRAM_TOKEN);

  bot.start((ctx) => ctx.reply("Hi! I’m Luna 🌙 Send me a message!"));
  bot.on("text", async (ctx) => {
    const text = ctx.message.text || "";
    const result = sentiment.analyze(text);
    let prefix = "Luna";
    if (result.score >= 2) prefix = "Luna (happy)";
    else if (result.score <= -2) prefix = "Luna (concerned)";
    await ctx.reply(`${prefix}: ${text}`);
  });

  // Webhook mode (prevents 409 conflicts)
  app.use(bot.webhookCallback("/telegram"));
  if (PUBLIC_URL) {
    bot.telegram
      .setWebhook(`${PUBLIC_URL.replace(/\/+$/, "")}/telegram`)
      .then(() => console.log("✅ Telegram webhook set"))
      .catch((e) => console.error("Failed to set webhook:", e.message));
  } else {
    console.warn(
      "⚠️ PUBLIC URL not detected (RENDER_EXTERNAL_URL or PUBLIC_URL). Webhook not set."
    );
  }
} else {
  console.warn("⚠️ TELEGRAM_TOKEN not set. Telegram disabled.");
}

/* -------------------- START -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
