import express from "express";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Chat endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Luna, a warm and helpful AI." },
        { role: "user", content: message }
      ]
    });
    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ reply: "⚠️ Error: " + err.message });
  }
});

// --- Avatars endpoint ---
app.get("/avatars", (req, res) => {
  const avatarsDir = path.join(__dirname, "public/avatars");
  let files = [];
  try {
    if (fs.existsSync(avatarsDir)) {
      files = fs.readdirSync(avatarsDir).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
    }
  } catch (e) {
    console.error(e);
  }
  res.json(files.map(f => "avatars/" + f));
});

app.listen(PORT, () => console.log(`🚀 Luna running at http://localhost:${PORT}`));
