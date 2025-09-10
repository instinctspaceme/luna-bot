import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const configPath = path.join(__dirname, "config.json");
let config = {
  personality: "friendly",
  voice: "alloy",
  avatar: "avatars/fallback.png",
  background: "default.jpg"
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Config routes ---
app.get("/config", (req, res) => res.json(config));
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

// --- Avatar list route ---
app.get("/avatars", (req, res) => {
  const avatarsDir = path.join(__dirname, "public/avatars");
  let files = [];
  try {
    if (fs.existsSync(avatarsDir)) {
      files = fs.readdirSync(avatarsDir)
        .filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
        .map(f => `avatars/${f}`);
    }
  } catch (err) {
    console.error("Avatar scan failed:", err);
  }
  res.json(files);
});

// --- Chat endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const messages = [
      { role: "system", content: `You are Luna, a ${config.personality} AI assistant. Be warm, concise, and helpful.` },
      ...history,
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const reply = completion.choices[0].message.content || "…";
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ reply: "⚠️ Error: " + err.message });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
