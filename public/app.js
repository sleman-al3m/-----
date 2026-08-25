const socket = io();
let role = "sleeper";
let joined = false;
let alarmAudio = null;
let alarmTimer = null;

const $ = id => document.getElementById(id);
const tabs = document.querySelectorAll(".tab");
const room = $("room");

tabs.forEach(t => t.onclick = () => {
  tabs.forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  role = t.dataset.role;
  $("sleeperPanel").classList.toggle("hidden", role !== "sleeper");
  $("friendPanel").classList.toggle("hidden", role !== "friend");
});

$("join").onclick = () => {
  const code = room.value.trim().toUpperCase();
  if (!code) return alert("اكتب رمز الغرفة أولاً.");
  socket.emit("joinRoom", { room: code, role });
  joined = true;
};

$("sleepBtn").onclick = async () => {
  if (!joined) return alert("ادخل الغرفة أولاً.");
  // User gesture: unlock audio before the phone/computer is left in sleep mode.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.03);
    window.__audioUnlocked = true;
  } catch {}
  socket.emit("enterSleep");
  $("sleepStatus").classList.add("online");
  $("sleepStatus").innerHTML = '<span class="dot"></span><span>أنت الآن في وضع النوم</span>';
  $("sleepBtn").classList.add("hidden");
  $("wakeBtn").classList.remove("hidden");
};

$("wakeBtn").onclick = () => {
  stopAlarm();
  socket.emit("wakeUp");
  $("sleepStatus").classList.remove("online");
  $("sleepStatus").innerHTML = '<span class="dot"></span><span>استيقظت — المنبّه متوقف</span>';
  $("wakeBtn").classList.add("hidden");
  $("sleepBtn").classList.remove("hidden");
};

function updateFriend(sleeperOnline) {
  const status = $("friendStatus");
  const btn = $("alarmBtn");
  status.classList.toggle("online", sleeperOnline);
  status.innerHTML = `<span class="dot"></span><span>${sleeperOnline ? "صاحب وضع النوم متصل" : "بانتظار صاحب وضع النوم..."}</span>`;
  btn.disabled = !sleeperOnline;
}

socket.on("presence", ({ sleeperOnline }) => {
  if (role === "friend") updateFriend(sleeperOnline);
});

socket.on("state", ({ sleeping }) => {
  if (role === "friend") updateFriend(sleeping);
});

socket.on("triggerResult", result => {
  if (!result.ok) alert(result.message || "تعذر تفعيل المنبّه.");
});

$("alarmBtn").onclick = () => socket.emit("triggerAlarm");

socket.on("alarm", () => {
  // IMPORTANT: only the sleeper is allowed to start the local alarm.
  // The friend can press the button, but never plays the alarm on their device.
  if (role !== "sleeper") return;
  startAlarm();
});

function startAlarm() {
  $("alarmOverlay").classList.remove("hidden");
  document.body.classList.add("alarming");
  if (navigator.vibrate) navigator.vibrate([500,150,500,150,800]);

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  alarmAudio = { ctx, nodes: [] };
  const gain = ctx.createGain();
  gain.gain.value = 0.16;
  gain.connect(ctx.destination);

  // Harsh alternating siren generated locally; no external audio file required.
  const freqs = [880, 1660, 990, 1860];
  let i = 0;
  const tick = () => {
    if (!alarmAudio) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freqs[i++ % freqs.length];
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    alarmAudio.nodes.push(osc);
    alarmTimer = setTimeout(tick, 190);
  };
  ctx.resume().then(tick);
}

$("stopAlarm").onclick = stopAlarm;

function stopAlarm() {
  if (alarmTimer) clearTimeout(alarmTimer);
  alarmTimer = null;
  if (alarmAudio) {
    try { alarmAudio.ctx.close(); } catch {}
  }
  alarmAudio = null;
  $("alarmOverlay").classList.add("hidden");
  document.body.classList.remove("alarming");
  if (navigator.vibrate) navigator.vibrate(0);
}