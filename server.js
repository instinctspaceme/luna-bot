import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// --- CONFIG ---
const configPath = path.join(__dirname, "config.json");
let config = {
  avatar: "avatars/luna.png",
  background: "black",
  personality: "friendly and helpful"
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

// Fake chat endpoint (replace later with OpenAI if needed)
app.post("/chat", (req, res) => {
  const { message } = req.body;
  res.json({ reply: `Luna says: "${message}" 😊` });
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
