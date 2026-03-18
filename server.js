const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Game state
let gameState = {
  phase: "lobby", // lobby, question, results, leaderboard, podium
  questions: [],
  currentQuestionIndex: -1,
  players: {},
  answers: {},
  timerSeconds: 20,
  questionStartTime: null
};

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

// API: set questions
app.post("/api/questions", (req, res) => {
  gameState.questions = req.body.questions || [];
  gameState.timerSeconds = req.body.timerSeconds || 20;
  res.json({ ok: true, count: gameState.questions.length });
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

  // Player joins
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

  // Host joins
  socket.on("hostJoin", () => {
    socket.join("host");
    socket.emit("playerUpdate", getPlayerList());
    socket.emit("phaseUpdate", { phase: gameState.phase });
  });

  // Host starts next question
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

    // Timer
    setTimeout(() => {
      if (gameState.phase === "question" &&
          gameState.currentQuestionIndex === questionData.index) {
        endQuestion();
      }
    }, gameState.timerSeconds * 1000);
  });

  // Host shows leaderboard
  socket.on("showLeaderboard", () => {
    gameState.phase = "leaderboard";
    const lb = getLeaderboard();
    io.to("host").emit("leaderboard", lb);
    io.to("players").emit("leaderboardPlayer", lb);
  });

  // Player submits answer
  socket.on("answer", (data) => {
    if (gameState.phase !== "question") return;
    if (gameState.answers[socket.id]) return; // already answered
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

    // Notify host of answer count
    const answerCount = Object.keys(gameState.answers).length;
    const playerCount = Object.keys(gameState.players).length;
    io.to("host").emit("answerCount", { count: answerCount, total: playerCount });

    // Auto-end if everyone answered
    if (answerCount >= playerCount) {
      endQuestion();
    }
  });

  // Host resets game
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

  // Count answers per option
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
