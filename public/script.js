async function loadConfig() {
  const res = await fetch("/config");
  return await res.json();
}

async function init() {
  const config = await loadConfig();
  document.getElementById("avatar").src = config.avatar || "avatars/fallback.png";

  const chatBox = document.getElementById("chat-box");
  const input = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");
  let history = [];

  function addMessage(sender, text) {
    const div = document.createElement("div");
    div.textContent = `${sender}: ${text}`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    addMessage("You", text);
    input.value = "";

    const res = await fetch("/chat", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ message: text, history })
    });
    const data = await res.json();
    addMessage("Luna", data.reply);

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: data.reply });
  }

  sendBtn.onclick = sendMessage;
  input.addEventListener("keypress", e => {
    if (e.key === "Enter") sendMessage();
  });
}
init();
