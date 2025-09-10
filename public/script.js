// script.js — front-end glue: load config, send chat, play audio
async function fetchConfig() {
  try {
    const res = await fetch("/config");
    return await res.json();
  } catch (e) {
    console.warn("config fetch failed", e);
    return null;
  }
}

function addMessage(sender, text, cls="") {
  const messages = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = "message " + (cls || (sender==="You"?"you":"luna"));
  div.textContent = `${sender}: ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

async function loadAvatarFromConfig() {
  const cfg = await fetchConfig();
  if (!cfg) return;
  const img = document.getElementById("avatar");
  img.src = cfg.avatar || "avatars/fallback.png";
  img.onerror = () => { img.src = "avatars/fallback.png"; };
}

async function sendMessage() {
  const input = document.getElementById("input");
  const text = input.value.trim();
  if (!text) return;
  addMessage("You", text, "you");
  input.value = "";
  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ message: text, history: [] })
    });
    const data = await res.json();
    if (data.error) {
      addMessage("System", "Error: " + data.error);
      return;
    }
    addMessage("Luna", data.reply, "luna");

    // update avatar mood: simple mapping (you must supply variations manually if desired)
    if (data.mood === "happy") {
      // optionally look for "..._happy.png" naming
      const base = (await fetchConfig()).avatar || "avatars/fallback.png";
      const happyCandidate = base.replace(/(\.[a-zA-Z]+)$/, "_happy$1");
      // quick check existence
      fetch(happyCandidate, { method: "HEAD" }).then(r => {
        if (r.ok) document.getElementById("avatar").src = happyCandidate;
      });
    } else if (data.mood === "sad") {
      const base = (await fetchConfig()).avatar || "avatars/fallback.png";
      const sadCandidate = base.replace(/(\.[a-zA-Z]+)$/, "_sad$1");
      fetch(sadCandidate, { method: "HEAD" }).then(r => {
        if (r.ok) document.getElementById("avatar").src = sadCandidate;
      });
    } else {
      // neutral => reset to configured avatar
      loadAvatarFromConfig();
    }

    // audio: if server returned an audio base64, play it
    if (data.audio) {
      const audio = new Audio("data:audio/mp3;base64," + data.audio);
      // while audio plays you might want to add a small UI indicator; we'll just play
      await audio.play().catch(e => console.warn("audio play blocked", e));
    } else {
      // fallback if no server TTS: try browser speechSynthesis
      const utter = new SpeechSynthesisUtterance(data.reply);
      // pick a voice that sounds good (best-effort)
      const voices = speechSynthesis.getVoices();
      if (voices.length) {
        // prefer a non-robotic voice if available
        const prefer = voices.find(v => /en.*(female|alloy|Samantha|Google)/i.test(v.name)) || voices[0];
        utter.voice = prefer;
      }
      speechSynthesis.speak(utter);
    }
  } catch (err) {
    console.error("send error", err);
    addMessage("System", "Network error: " + String(err));
  }
}

document.getElementById("send").addEventListener("click", sendMessage);
document.getElementById("input").addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

loadAvatarFromConfig();
