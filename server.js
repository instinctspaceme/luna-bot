import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Telegraf } from "telegraf";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// --- CONFIG ---
const configPath = path.join(__dirname, "config.json");
let config = {
  globalAvatar: "luna1.png",
  background: "default.jpg",
  voice: "alloy",
  expressions: {
    happy: "luna_happy.png",
    sad: "luna_sad.png",
    neutral: "luna1.png"
  }
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// --- ROUTES ---
app.get("/config", (req, res) => res.json(config));

app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

// Avatars list (both /public/avatars and /public root)
app.get("/avatars", (req, res) => {
  const avatarsDir = path.join(__dirname, "public/avatars");
  let files = [];
  try {
    if (fs.existsSync(avatarsDir)) {
      files = fs.readdirSync(avatarsDir)
        .filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
        .map(f => `avatars/${f}`);
    }
    const publicFiles = fs.readdirSync(path.join(__dirname, "public"))
      .filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
      .map(f => f);
    files = [...files, ...publicFiles];
  } catch (err) {
    console.error("Avatar scan failed:", err);
  }
  res.json(files);
});

// --- TELEGRAM BOT ---
if (process.env.TELEGRAM_TOKEN && process.env.RENDER_EXTERNAL_URL) {
  const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
  bot.start(ctx => ctx.reply("Hi! I’m Luna 🌙"));
  bot.on("text", async ctx => {
    const msg = ctx.message.text.toLowerCase();
    let expression = config.expressions.neutral;
    if (msg.includes("happy")) expression = config.expressions.happy;
    if (msg.includes("sad")) expression = config.expressions.sad;
    await ctx.reply(`Luna (${expression.replace(".png","")}): ${ctx.message.text}`);
  });
  app.use(bot.webhookCallback("/telegram"));
  bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/telegram`);
}

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
