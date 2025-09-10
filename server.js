// server.js
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

const CONFIG_PATH = path.join(__dirname, "config.json");

// default config
let config = {
  avatar: "avatars/fallback.png",
  voice: "verse",
  mood: "neutral",              // user preference for voice mood
  personality: "friendly and concise",
  voiceOptions: ["verse","sage","nova","alloy"] // choices available
};

// load saved config if any
if (fs.existsSync(CONFIG_PATH)) {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) }; }
  catch(e) { console.warn("config.json parse error:", e); }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// list available avatars from public/avatars
app.get("/avatars", (req, res) => {
  const avatarsDir = path.join(__dirname, "public", "avatars");
  let files = [];
  try {
    if (fs.existsSync(avatarsDir)) {
      files = fs.readdirSync(avatarsDir).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f));
    }
  } catch (e) {
    console.error("avatars read error:", e);
  }
  // return full path relative to /public
  const paths = files.map(f => `avatars/${f}`);
  if (paths.length === 0) paths.push("avatars/fallback.png");
  res.json(paths);
});

// get / update config
app.get("/config", (req, res) => res.json(config));
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

// chat endpoint: uses OpenAI if API key present, otherwise fallback
app.post("/chat", async (req, res) => {
  const openaiKey = process.env.OPENAI_API_KEY;
  const { message, history = [] } = req.body;
  if (!message || message.trim().length === 0) return res.status(400).json({ error: "Message required" });

  // If OpenAI API key configured -> do real chat + TTS
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey });

      // chat completion
      const chatResp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are Luna, a ${config.personality} AI assistant. Keep responses friendly and concise.` },
          ...history,
          { role: "user", content: message }
        ],
      });

      const reply = chatResp.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate an answer.";

      // TTS - returns binary audio (we base64 it back)
      // NOTE: model name and TTS API may vary; this follows common patterns
      const ttsResp = await client.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: config.voice || "verse",
        input: reply,
        // optionally you could add ``style`` or ``mood`` depending on provider; not all voices support it
      });

      const arrayBuffer = await ttsResp.arrayBuffer();
      const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

      // Return reply + audio + mood guess (frontend uses mood to switch image)
      // We'll do a tiny sentiment check server-side to give a mood flag
      const mood = simpleSentiment(message + " " + reply);

      res.json({ reply, audio: audioBase64, mood });
    } catch (err) {
      console.error("OpenAI error:", err);
      res.status(500).json({ error: String(err) });
    }

  } else {
    // fallback: simple canned reply + browser TTS could be used by frontend
    const reply = simulateReply(message);
    const mood = simpleSentiment(message + " " + reply);
    res.json({ reply, audio: null, mood });
  }
});

function simulateReply(msg) {
  const txt = msg.toLowerCase();
  if (txt.includes("hello") || txt.includes("hi")) return "Hi — I’m Luna! How can I help?";
  if (txt.includes("how are you")) return "I’m doing great — thanks for asking!";
  if (txt.includes("sad") || txt.includes("upset")) return "I’m sorry to hear that. I’m here for you.";
  return "Nice — tell me more.";
}

// tiny sentiment helper to return 'happy'|'sad'|'neutral'
function simpleSentiment(text="") {
  const pos = ["good","great","happy","love","awesome","nice","thank","yay"];
  const neg = ["sad","bad","angry","hate","upset","terrible","no"];
  const t = text.toLowerCase();
  let score = 0;
  pos.forEach(w => { if (t.includes(w)) score++; });
  neg.forEach(w => { if (t.includes(w)) score--; });
  if (score > 0) return "happy";
  if (score < 0) return "sad";
  return "neutral";
}

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
