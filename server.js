import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const configPath = path.join(__dirname, "config.json");
let config = { globalAvatar: "luna1.png", background: "default.jpg", voice: "alloy" };

// load config
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath));
}

// save config endpoint
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  res.json({ success: true });
});

// get config
app.get("/config", (req, res) => {
  res.json(config);
});

// list avatars (from avatars/ or public/)
app.get("/avatars", (req, res) => {
  const avatarsDir = path.join(__dirname, "public/avatars");
  let files = [];
  try {
    if (fs.existsSync(avatarsDir)) {
      files = fs.readdirSync(avatarsDir).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f)).map(f => `avatars/${f}`);
    }
    // also check public/
    const publicFiles = fs.readdirSync(path.join(__dirname, "public"))
      .filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
      .map(f => f);
    files = [...files, ...publicFiles];
  } catch (err) {
    console.error("Avatar scan failed", err);
  }
  res.json(files);
});

// Telegram bot setup
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

bot.start((ctx) => ctx.reply("Hi! I’m Luna 🌙"));
bot.on("text", async (ctx) => {
  ctx.reply(`You said: ${ctx.message.text}`);
});

app.use(bot.webhookCallback("/telegram"));
bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/telegram`);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
