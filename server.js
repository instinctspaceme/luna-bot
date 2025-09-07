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
  personality: "friendly",
  voice: "alloy",
  avatar: "neutral.png"
};
if (fs.existsSync(configPath)) {
  config = { ...config, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
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

// List avatars
app.get("/avatars", (req, res) => {
  let files = [];
  try {
    const avatarsDir = path.join(__dirname, "public/avatars");
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
  if (files.length === 0) files = ["neutral.png"];
  res.json(files);
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
