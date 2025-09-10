async function loadConfig() {
  const res = await fetch("/config");
  const config = await res.json();
  const avatarEl = document.getElementById("avatar");
  avatarEl.src = config.avatar || "avatars/fallback.png";
}

function addMessage(sender, text) {
  const msgBox = document.getElementById("messages");
  const div = document.createElement("div");
  div.textContent = `${sender}: ${text}`;
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
}

document.getElementById("sendBtn").addEventListener("click", async () => {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;
  addMessage("You", text);
  input.value = "";

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    const data = await res.json();
    addMessage("Luna", data.reply);

    if (data.audio) {
      const audio = new Audio("data:audio/mp3;base64," + data.audio);
      audio.play();
    }
  } catch (err) {
    addMessage("System", "⚠️ Error: " + err.message);
  }
});

loadConfig();
