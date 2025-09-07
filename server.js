import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Load config
const configPath = path.join(__dirname, "config.json");
let config = {
  avatar: "luna.png",     // default avatar file in /public
  voice: "alloy",
  personality: "friendly AI assistant"
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// API - get config
app.get("/config", (req, res) => {
  res.json(config);
});

// API - update config
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig();
  res.json({ success: true, config });
});

// API - avatar direct route (always returns current avatar)
app.get("/avatar", (req, res) => {
  const avatarPath = path.join(__dirname, "public", config.avatar);
  if (fs.existsSync(avatarPath)) {
    res.sendFile(avatarPath);
  } else {
    res.sendFile(path.join(__dirname, "public", "fallback.png")); // fallback
  }
});

// Dummy chat API (replace with OpenAI later)
app.post("/chat", (req, res) => {
  const { message } = req.body;
  const reply = `Luna says: "${message}" 😊`;
  res.json({ reply });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
