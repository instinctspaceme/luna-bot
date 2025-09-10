import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// --- CONFIG ---
const configPath = path.join(__dirname, "config.json");
let config = {
  avatarNeutral: "avatars/luna_neutral.png",
  avatarHappy: "avatars/luna_happy.png",
  avatarSad: "avatars/luna_sad.png",
  fallback: "avatars/fallback.png",
  name: "Luna"
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// --- Simple sentiment helper ---
function sentiment(text = "") {
  const pos = ["happy","great","good","awesome","love","yes"];
  const neg = ["sad","bad","hate","angry","no"];
  let score = 0;
  const lower = text.toLowerCase();
  pos.forEach(w => { if (lower.includes(w)) score++; });
  neg.forEach(w => { if (lower.includes(w)) score--; });
  return score > 0 ? "happy" : score < 0 ? "sad" : "neutral";
}

// --- ROUTES ---
app.get("/config", (req, res) => res.json(config));

app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

app.post("/chat", (req, res) => {
  const userMsg = req.body.message || "";
  let reply = "I’m not sure what to say yet.";
  if (userMsg.toLowerCase().includes("hello")) reply = "Hi there! I’m Luna 🌙";
  if (userMsg.toLowerCase().includes("how are you")) reply = "I’m feeling great, thanks for asking!";
  if (userMsg.toLowerCase().includes("sad")) reply = "Oh no, I hope things get better soon ❤️";

  const mood = sentiment(userMsg + " " + reply);

  res.json({ reply, mood });
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
