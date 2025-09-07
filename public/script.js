const messagesDiv = document.getElementById("messages");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const ttsAudio = document.getElementById("ttsAudio");

let history = [];

function appendMessage(sender, text) {
  const div = document.createElement("div");
  div.className = sender;
  div.textContent = `${sender}: ${text}`;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

sendBtn.onclick = async () => {
  const message = userInput.value.trim();
  if (!message) return;

  appendMessage("You", message);
  userInput.value = "";

  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history })
  });

  const data = await res.json();
  appendMessage("Luna", data.reply);

  // Update history
  history.push({ role: "user", content: message });
  history.push({ role: "assistant", content: data.reply });

  // Play TTS
  if (data.audio) {
    const audioBlob = new Blob([Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))], { type: "audio/mp3" });
    const audioUrl = URL.createObjectURL(audioBlob);
    ttsAudio.src = audioUrl;
    ttsAudio.play();
  }
};
