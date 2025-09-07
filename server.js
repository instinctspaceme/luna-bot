import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Load config
const configPath = path.join(__dirname, "config.json");
let config = {
  avatar: "luna.png",
  background: "default.jpg",
  voice: "alloy",
  personality: "friendly and helpful"
};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
}

// Serve config
app.get("/config", (req, res) => res.json(config));

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
