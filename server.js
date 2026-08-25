const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
// roomCode -> { sleeperSocketId, friendSocketId, sleeping, alarmPresses, alarmStartedAt, createdAt }

io.on("connection", socket => {
  socket.on("joinRoom", ({ room, role }) => {
    room = String(room || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(room)) {
      return socket.emit("errorMessage", "رمز الغرفة غير صالح.");
    }

    socket.join(room);
    if (!rooms.has(room)) {
      rooms.set(room, { sleeperSocketId: null, friendSocketId: null, sleeping: false, alarmPresses: 0, alarmStartedAt: null, createdAt: Date.now() });
    }

    const state = rooms.get(room);

    if (role === "sleeper") {
      state.sleeperSocketId = socket.id;
      socket.data.role = "sleeper";
      socket.data.room = room;
      state.sleeping = false;
      socket.emit("state", { sleeping: false });
      io.to(room).emit("presence", { sleeperOnline: true });
    } else {
      socket.data.role = "friend";
      socket.data.room = room;
      state.friendSocketId = socket.id;
      socket.emit("state", { sleeping: state.sleeping, alarmPresses: state.alarmPresses });
      socket.emit("presence", { sleeperOnline: Boolean(state.sleeperSocketId) });
    }
  });

  socket.on("enterSleep", () => {
    const room = socket.data.room;
    const state = rooms.get(room);
    if (!room || !state || socket.data.role !== "sleeper") return;
    state.sleeping = true;
    state.alarmPresses = 0;
    state.alarmStartedAt = null;
    io.to(room).emit("state", { sleeping: true, alarmPresses: 0 });
    io.to(room).emit("presence", { sleeperOnline: true });
  });

  socket.on("triggerAlarm", () => {
    const room = socket.data.room;
    const state = rooms.get(room);
    if (!room || !state || socket.data.role !== "friend") return;

    if (!state.sleeping || !state.sleeperSocketId) {
      return socket.emit("triggerResult", { ok: false, message: "صاحب وضع النوم غير متصل أو لم يدخل وضع النوم." });
    }

    if (state.alarmPresses >= 5) {
      return socket.emit("triggerResult", { ok: true, presses: 5, started: true });
    }

    state.alarmPresses += 1;
    const remaining = 5 - state.alarmPresses;

    if (state.alarmPresses === 5) {
      state.alarmStartedAt = Date.now();
      // Send the alarm ONLY to the socket that explicitly joined as sleeper.
      if (state.sleeperSocketId) {
        io.to(state.sleeperSocketId).emit("alarm");
      }
      io.to(room).emit("alarmCountdown", { seconds: 30 });
      setTimeout(() => {
        const current = rooms.get(room);
        if (current && current.sleeping && current.sleeperSocketId && current.alarmStartedAt) {
          io.to(current.sleeperSocketId).emit("voiceOpen", { reason: "30 ثانية انتهت" });
          io.to(current.friendSocketId || "").emit("voiceOpenFriend");
        }
      }, 30000);
      return socket.emit("triggerResult", { ok: true, presses: 5, started: true });
    }

    socket.emit("triggerResult", { ok: true, presses: state.alarmPresses, remaining });
  });

  socket.on("wakeUp", () => {
    const room = socket.data.room;
    const state = rooms.get(room);
    if (!room || !state || socket.data.role !== "sleeper") return;

    state.sleeping = false;
    state.alarmPresses = 0;
    state.alarmStartedAt = null;
    io.to(room).emit("state", { sleeping: false, alarmPresses: 0 });
    io.to(room).emit("voiceOpenFriend");
    io.to(room).emit("presence", { sleeperOnline: Boolean(state.sleeperSocketId) });
  });


  socket.on("voiceSignal", data => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit("voiceSignal", data);
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    const state = rooms.get(room);
    if (!room || !state) return;

    if (state.sleeperSocketId === socket.id) {
      state.sleeperSocketId = null;
      state.sleeping = false;
      state.alarmPresses = 0;
      state.alarmStartedAt = null;
      io.to(room).emit("state", { sleeping: false });
      io.to(room).emit("presence", { sleeperOnline: false });
    }
    setTimeout(() => {
      const current = rooms.get(room);
      if (current && !current.sleeperSocketId && Date.now() - current.createdAt > 10 * 60 * 1000) {
        rooms.delete(room);
      }
    }, 1000);
  });
});

server.listen(PORT, () => {
  console.log(`Sleep Mode Alarm running on http://localhost:${PORT}`);
});