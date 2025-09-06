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
  voice: "",
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
    console.error("Failed to parse config.json, using defaults:", e.message);
  }
}
const saveConfig = () =>
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

/* -------------------- HELPERS -------------------- */
function listImageFiles(dirAbs) {
  if (!fs.existsSync(dirAbs)) return [];
  return fs
    .readdirSync(dirAbs)
    .filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
}

/* -------------------- ROUTES -------------------- */
app.get("/healthz", (_, res) => res.send("ok"));

app.get("/config", (_, res) => res.json(config));

app.post("/config", (req, res) => {
  try {
    config = { ...config, ...req.body };
    saveConfig();
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* List avatars from /public/avatars and /public (mobile friendly) */
app.get("/avatars", (req, res) => {
  try {
    const avatarsDir = path.join(__dirname, "public", "avatars");
    const publicDir = path.join(__dirname, "public");

    const inAvatars = listImageFiles(avatarsDir).map((f) => `avatars/${f}`);
    const inPublic = listImageFiles(publicDir);

    // Avoid duplicates if same filename exists in both places
    const set = new Set([...inAvatars, ...inPublic]);
    res.json(Array.from(set));
  } catch (e) {
    console.error("Avatar scan failed:", e);
    res.json([]);
  }
});

/* Simple chat API: echoes back & suggests an expression from sentiment */
app.post("/api/chat", async (req, res) => {
  try {
    const { message = "" } = req.body || {};
    const result = sentiment.analyze(message || "");
    let expression = config.expressions.neutral;

    if (result.score >= 2) expression = config.expressions.happy;
    else if (result.score <= -2) expression = config.expressions.sad;

    // Very basic "AI" reply stub (replace with your LLM later)
    const reply =
      result.score >= 2
        ? "I love that vibe! 😊"
        : result.score <= -2
        ? "I’m here for you. 💜"
        : "Got it!";

    res.json({ reply, expression });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

  // Webhook mode (no polling = no more 409)
  app.use(bot.webhookCallback("/telegram"));
  if (PUBLIC_URL) {
    bot.telegram
      .setWebhook(`${PUBLIC_URL.replace(/\/+$/, "")}/telegram`)
      .then(() => console.log("✅ Telegram webhook set"))
      .catch((e) => console.error("Failed to set webhook:", e.message));
  } else {
    console.warn(
      "⚠️ No PUBLIC URL detected (RENDER_EXTERNAL_URL or PUBLIC_URL). Webhook not set."
    );
  }
} else {
  console.warn("⚠️ TELEGRAM_TOKEN not set. Telegram bot disabled.");
}

/* -------------------- START -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
