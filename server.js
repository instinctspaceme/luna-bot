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
  personality: "friendly and helpful",
  voice: "alloy",
  avatar: "neutral.png"
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Sentiment helper ---
function quickSentiment(text = "") {
  const pos = ["great","good","awesome","love","happy","yes","cool","thanks","nice","amazing"];
  const neg = ["bad","sad","angry","hate","no","terrible","awful","pain","sorry"];
  let score = 0;
  const t = text.toLowerCase();
  pos.forEach(w => t.includes(w) && (score += 1));
  neg.forEach(w => t.includes(w) && (score -= 1));
  return score > 0 ? "happy" : score < 0 ? "sad" : "neutral";
}

// --- CHAT ENDPOINT (Web UI) ---
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const messages = [
      { role: "system", content: `You are Luna, a ${config.personality} AI assistant.` },
      ...history,
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const reply = completion.choices[0].message.content || "…";
    const mood = quickSentiment(`${message} ${reply}`);

    // TTS
    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: config.voice,
      input: reply
    });
    const audioBuffer = Buffer.from(await tts.arrayBuffer());

    res.json({
      reply,
      audio: audioBuffer.toString("base64"),
      mood
    });
  } catch (err) {
    console.error("API /chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- CONFIG ROUTES ---
app.get("/config", (req, res) => res.json(config));
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

// --- START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
