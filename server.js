import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const configPath = path.join(__dirname, "config.json");
let config = {
  personality: "friendly",
  voice: "alloy",
  avatar: "avatars/fallback.png"
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- ROUTES ---
app.get("/config", (req, res) => res.json(config));

app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

// Avatars
app.get("/avatars", (req, res) => {
  const avatarsDir = path.join(__dirname, "public/avatars");
  let files = [];
  if (fs.existsSync(avatarsDir)) {
    files = fs.readdirSync(avatarsDir)
      .filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
      .map(f => `avatars/${f}`);
  }
  if (files.length === 0) files = ["avatars/fallback.png"];
  res.json(files);
});

// --- CHAT with OpenAI ---
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

    // Generate TTS
    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: config.voice || "alloy",
      input: reply
    });

    const audioBuffer = Buffer.from(await tts.arrayBuffer());

    res.json({
      reply,
      audio: audioBuffer.toString("base64")
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`✅ Luna running at http://localhost:${PORT}`);
});
