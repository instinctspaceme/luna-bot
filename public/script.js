async function loadConfig() {
  const res = await fetch("/config");
  return res.json();
}

async function loadAvatars() {
  const res = await fetch("/avatars");
  return res.json();
}

async function renderPrefs() {
  const cfg = await loadConfig();
  const avatars = await loadAvatars();
  const select = document.getElementById("avatarSelect");
  select.innerHTML = "";
  avatars.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    if (a === cfg.globalAvatar) opt.selected = true;
    select.appendChild(opt);
  });
  document.getElementById("avatar").src = cfg.globalAvatar;
}

async function savePrefs() {
  const avatar = document.getElementById("avatarSelect").value;
  await fetch("/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ globalAvatar: avatar })
  });
  document.getElementById("avatar").src = avatar;
}

renderPrefs();
