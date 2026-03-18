const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ dest: "uploads/" });
const DATA_FILE = path.join(__dirname, "questions.json");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Game state
let gameState = {
  phase: "lobby",
  questions: [],
  currentQuestionIndex: -1,
  players: {},
  answers: {},
  timerSeconds: 20,
  questionStartTime: null
};

// Load saved questions on startup
try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    gameState.questions = saved.questions || [];
    gameState.timerSeconds = saved.timerSeconds || 20;
    console.log("Loaded " + gameState.questions.length + " saved questions");
  }
} catch (e) {
  console.log("No saved questions found");
}

const MAX_POINTS = 1000;
const MIN_POINTS = 500;

// API: generate QR code
app.get("/api/qr", async (req, res) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers.host;
  const url = protocol + "://" + host;
  try {
    const qr = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    res.json({ qr, url });
  } catch (e) {
    res.status(500).json({ error: "QR generation failed" });
  }
});

// API: set questions (and save to file)
app.post("/api/questions", (req, res) => {
  gameState.questions = req.body.questions || [];
  gameState.timerSeconds = req.body.timerSeconds || 20;
  // Save to file
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      questions: gameState.questions,
      timerSeconds: gameState.timerSeconds
    }, null, 2));
  } catch (e) {
    console.error("Failed to save questions:", e);
  }
  res.json({ ok: true, count: gameState.questions.length });
});

// API: get saved questions
app.get("/api/questions", (req, res) => {
  res.json({
    questions: gameState.questions,
    timerSeconds: gameState.timerSeconds
  });
});

// API: upload Excel
app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const questions = [];
    const correctMap = { "A": 0, "B": 1, "C": 2, "D": 3, "a": 0, "b": 1, "c": 2, "d": 3 };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const text = String(row[1]).trim();
      const options = [
        String(row[2] || "").trim(),
        String(row[3] || "").trim(),
        String(row[4] || "").trim(),
        String(row[5] || "").trim()
      ];
      const correctLetter = String(row[6] || "").trim().toUpperCase();
      const correct = correctMap[correctLetter];

      if (text && options.every(o => o) && correct !== undefined) {
        questions.push({ text, options, correct });
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if (questions.length === 0) {
      return res.status(400).json({ error: "Keine gültigen Fragen gefunden" });
    }

    gameState.questions = questions;
    // Save to file
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        questions: gameState.questions,
        timerSeconds: gameState.timerSeconds
      }, null, 2));
    } catch (e) {
      console.error("Failed to save questions:", e);
    }

    res.json({ ok: true, count: questions.length, questions });
  } catch (e) {
    res.status(500).json({ error: "Fehler beim Lesen der Datei: " + e.message });
  }
});

// API: get game state
app.get("/api/state", (req, res) => {
  res.json({
    phase: gameState.phase,
    playerCount: Object.keys(gameState.players).length,
    questionCount: gameState.questions.length,
    currentQuestion: gameState.currentQuestionIndex
  });
});

io.on("connection", (socket) => {

  socket.on("join", (name) => {
    const trimmed = (name || "").trim().substring(0, 20);
    if (!trimmed) return;
    gameState.players[socket.id] = {
      name: trimmed,
      score: 0,
      answers: []
    };
    socket.join("players");
    socket.emit("joined", { name: trimmed });
    io.to("host").emit("playerUpdate", getPlayerList());
  });

  socket.on("hostJoin", () => {
    socket.join("host");
    socket.emit("playerUpdate", getPlayerList());
    socket.emit("phaseUpdate", { phase: gameState.phase });
    if (gameState.questions.length > 0) {
      socket.emit("questionsLoaded", { count: gameState.questions.length });
    }
  });

  socket.on("nextQuestion", () => {
    gameState.currentQuestionIndex++;
    if (gameState.currentQuestionIndex >= gameState.questions.length) {
      gameState.phase = "podium";
      const lb = getLeaderboard();
      io.to("host").emit("podium", lb);
      io.to("players").emit("podium", lb);
      return;
    }
    gameState.phase = "question";
    gameState.answers = {};
    gameState.questionStartTime = Date.now();

    const q = gameState.questions[gameState.currentQuestionIndex];
    const questionData = {
      index: gameState.currentQuestionIndex,
      total: gameState.questions.length,
      text: q.text,
      options: q.options,
      timer: gameState.timerSeconds
    };

    io.to("host").emit("question", { ...questionData, correct: q.correct });
    io.to("players").emit("question", questionData);

    setTimeout(() => {
      if (gameState.phase === "question" &&
          gameState.currentQuestionIndex === questionData.index) {
        endQuestion();
      }
    }, gameState.timerSeconds * 1000);
  });

  socket.on("showLeaderboard", () => {
    gameState.phase = "leaderboard";
    const lb = getLeaderboard();
    io.to("host").emit("leaderboard", lb);
    io.to("players").emit("leaderboardPlayer", lb);
  });

  socket.on("answer", (data) => {
    if (gameState.phase !== "question") return;
    if (gameState.answers[socket.id]) return;
    if (!gameState.players[socket.id]) return;

    const elapsed = (Date.now() - gameState.questionStartTime) / 1000;
    const q = gameState.questions[gameState.currentQuestionIndex];
    const isCorrect = data.option === q.correct;

    let points = 0;
    if (isCorrect) {
      const timeFraction = Math.min(elapsed / gameState.timerSeconds, 1);
      points = Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * timeFraction);
    }

    gameState.answers[socket.id] = {
      option: data.option,
      correct: isCorrect,
      points: points,
      time: elapsed
    };

    gameState.players[socket.id].score += points;
    gameState.players[socket.id].answers.push({
      questionIndex: gameState.currentQuestionIndex,
      option: data.option,
      correct: isCorrect,
      points: points,
      time: elapsed
    });

    socket.emit("answerResult", { correct: isCorrect, points: points });

    const answerCount = Object.keys(gameState.answers).length;
    const playerCount = Object.keys(gameState.players).length;
    io.to("host").emit("answerCount", { count: answerCount, total: playerCount });

    if (answerCount >= playerCount) {
      endQuestion();
    }
  });

  socket.on("resetGame", () => {
    gameState.phase = "lobby";
    gameState.currentQuestionIndex = -1;
    gameState.answers = {};
    gameState.questionStartTime = null;
    for (const id in gameState.players) {
      gameState.players[id].score = 0;
      gameState.players[id].answers = [];
    }
    io.to("host").emit("phaseUpdate", { phase: "lobby" });
    io.to("host").emit("playerUpdate", getPlayerList());
    io.to("players").emit("reset");
  });

  socket.on("disconnect", () => {
    if (gameState.players[socket.id]) {
      delete gameState.players[socket.id];
      io.to("host").emit("playerUpdate", getPlayerList());
    }
  });
});

function endQuestion() {
  if (gameState.phase !== "question") return;
  gameState.phase = "results";
  const q = gameState.questions[gameState.currentQuestionIndex];

  const results = {
    correct: q.correct,
    correctText: q.options[q.correct],
    stats: {}
  };

  q.options.forEach((opt, i) => { results.stats[i] = 0; });
  for (const id in gameState.answers) {
    const a = gameState.answers[id];
    if (results.stats[a.option] !== undefined) {
      results.stats[a.option]++;
    }
  }

  io.to("host").emit("results", results);
  io.to("players").emit("resultsPlayer", { correct: q.correct });
}

function getPlayerList() {
  return Object.values(gameState.players).map(p => ({
    name: p.name,
    score: p.score
  }));
}

function getLeaderboard() {
  return Object.values(gameState.players)
    .map(p => {
      const lastAnswer = p.answers.length > 0 ? p.answers[p.answers.length - 1] : null;
      return {
        name: p.name,
        score: p.score,
        lastTime: lastAnswer ? lastAnswer.time : null,
        lastCorrect: lastAnswer ? lastAnswer.correct : null,
        lastPoints: lastAnswer ? lastAnswer.points : 0
      };
    })
    .sort((a, b) => b.score - a.score);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Quiz server running on port " + PORT);
});
