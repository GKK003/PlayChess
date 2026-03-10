import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Chess } from "chess.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "db.json");

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

function id() {
  return crypto.randomBytes(8).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(dataFile)) {
    const adminPasswordHash = bcrypt.hashSync("admin123", 10);

    const seed = {
      users: [
        {
          id: id(),
          name: "Admin",
          email: "admin@playchess.com",
          passwordHash: adminPasswordHash,
          role: "admin",
          school: "",
          grade: "",
          createdAt: nowIso(),
        },
      ],
      tournaments: [],
      games: [],
    };

    fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2), "utf-8");
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dataFile, "utf-8"));
}

function writeDb(db) {
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2), "utf-8");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    school: user.school,
    grade: user.grade,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Admin only." });
  }
  next();
}

function getUserById(db, userId) {
  return db.users.find((u) => u.id === userId);
}

function getTournamentById(db, tournamentId) {
  return db.tournaments.find((t) => t.id === tournamentId);
}

function getGameById(db, gameId) {
  return db.games.find((g) => g.id === gameId);
}

function getStandingScore(tournament, userId) {
  return tournament.scores?.[userId] ?? 0;
}

function addScore(tournament, userId, points) {
  if (!tournament.scores) tournament.scores = {};
  tournament.scores[userId] = (tournament.scores[userId] || 0) + points;
}

function getPlayedSet(tournament) {
  const set = new Set();
  for (const key of tournament.pairHistory || []) {
    set.add(key);
  }
  return set;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function buildStandings(db, tournament) {
  const standings = (tournament.players || []).map((p) => {
    const user = getUserById(db, p.userId);
    return {
      userId: p.userId,
      name: user?.name || "Unknown",
      score: getStandingScore(tournament, p.userId),
    };
  });

  standings.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return standings;
}

function summarizeTournament(db, tournament) {
  return {
    ...tournament,
    playerCount: tournament.players?.length || 0,
    standings: buildStandings(db, tournament),
  };
}

function summarizeGame(db, game) {
  const white = getUserById(db, game.whiteId);
  const black = getUserById(db, game.blackId);
  const tournament = getTournamentById(db, game.tournamentId);

  return {
    ...game,
    whiteName: white?.name || "White",
    blackName: black?.name || "Black",
    tournamentName: tournament?.name || "Tournament",
    timeControl: tournament
      ? `${tournament.minutes}+${tournament.increment}`
      : "-",
  };
}

function settleTimeoutIfNeeded(db, game) {
  if (game.status !== "active" || !game.lastMoveAt) return false;

  const elapsed = Date.now() - new Date(game.lastMoveAt).getTime();

  if (game.activeColor === "w") {
    if (game.whiteMs - elapsed <= 0) {
      game.whiteMs = 0;
      game.status = "finished";
      game.result = "0-1";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      return true;
    }
  } else {
    if (game.blackMs - elapsed <= 0) {
      game.blackMs = 0;
      game.status = "finished";
      game.result = "1-0";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      return true;
    }
  }

  return false;
}

function applyGameResult(db, game) {
  if (game.scored) return;

  const tournament = getTournamentById(db, game.tournamentId);
  if (!tournament) return;

  if (game.result === "1-0") {
    addScore(tournament, game.whiteId, 1);
  } else if (game.result === "0-1") {
    addScore(tournament, game.blackId, 1);
  } else if (game.result === "1/2-1/2") {
    addScore(tournament, game.whiteId, 0.5);
    addScore(tournament, game.blackId, 0.5);
  }

  game.scored = true;

  const unfinishedThisRound = db.games.some(
    (g) =>
      g.tournamentId === tournament.id &&
      g.round === tournament.currentRound &&
      g.status !== "finished",
  );

  if (!unfinishedThisRound) {
    if (tournament.currentRound >= tournament.rounds) {
      tournament.status = "finished";
    } else {
      tournament.status = "waiting-next-round";
    }
  }

  tournament.updatedAt = nowIso();
}

function validateTournamentInput(body) {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const location = String(body.location || "").trim();
  const format = String(body.format || "swiss").trim();
  const rounds = Number(body.rounds);
  const minutes = Number(body.minutes);
  const increment = Number(body.increment);
  const maxPlayers = Number(body.maxPlayers);
  const startAt = String(body.startAt || "").trim();

  if (!name) throw new Error("Tournament name is required.");
  if (!location) throw new Error("Location is required.");
  if (!["swiss", "round-robin"].includes(format))
    throw new Error("Invalid format.");
  if (!Number.isFinite(rounds) || rounds < 1)
    throw new Error("Rounds must be at least 1.");
  if (!Number.isFinite(minutes) || minutes < 1)
    throw new Error("Minutes must be at least 1.");
  if (!Number.isFinite(increment) || increment < 0)
    throw new Error("Increment must be 0 or more.");
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2)
    throw new Error("Max players must be at least 2.");
  if (!startAt) throw new Error("Start date is required.");

  return {
    name,
    description,
    location,
    format,
    rounds,
    minutes,
    increment,
    maxPlayers,
    startAt,
  };
}

function canAccessGame(req, game) {
  if (req.auth.role === "admin") return true;
  return game.whiteId === req.auth.id || game.blackId === req.auth.id;
}

function nextRoundPairings(db, tournament) {
  const players = [...(tournament.players || [])].map((p) => ({
    ...p,
    score: getStandingScore(tournament, p.userId),
  }));

  players.sort((a, b) => b.score - a.score);

  const played = getPlayedSet(tournament);
  const pairings = [];
  const waiting = [...players];

  while (waiting.length > 1) {
    const p1 = waiting.shift();
    let index = waiting.findIndex(
      (p) => !played.has(pairKey(p1.userId, p.userId)),
    );
    if (index === -1) index = 0;
    const p2 = waiting.splice(index, 1)[0];

    pairings.push([p1.userId, p2.userId]);
  }

  const bye = waiting[0] || null;

  return { pairings, bye };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/register", (req, res) => {
  try {
    const db = readDb();

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const school = String(req.body.school || "").trim();
    const grade = String(req.body.grade || "").trim();

    if (!name) return res.status(400).json({ error: "Name is required." });
    if (!email) return res.status(400).json({ error: "Email is required." });
    if (!password || password.length < 4) {
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters." });
    }

    const exists = db.users.some((u) => u.email === email);
    if (exists) return res.status(400).json({ error: "Email already exists." });

    const user = {
      id: id(),
      name,
      email,
      passwordHash: bcrypt.hashSync(password, 10),
      role: "student",
      school,
      grade,
      createdAt: nowIso(),
    };

    db.users.push(user);
    writeDb(db);

    const token = signToken(user);
    return res.status(201).json({ token, user: publicUser(user) });
  } catch {
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/login", (req, res) => {
  try {
    const db = readDb();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");

    const user = db.users.find((u) => u.email === email);
    if (!user)
      return res.status(400).json({ error: "Invalid email or password." });

    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok)
      return res.status(400).json({ error: "Invalid email or password." });

    const token = signToken(user);
    return res.json({ token, user: publicUser(user) });
  } catch {
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/me", auth, (req, res) => {
  const db = readDb();
  const user = getUserById(db, req.auth.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

app.get("/api/tournaments", (_req, res) => {
  const db = readDb();

  for (const game of db.games) {
    settleTimeoutIfNeeded(db, game);
  }
  writeDb(db);

  const tournaments = db.tournaments
    .map((t) => summarizeTournament(db, t))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ tournaments });
});

app.get("/api/tournaments/:id", (_req, res) => {
  const db = readDb();
  const tournament = getTournamentById(db, _req.params.id);
  if (!tournament)
    return res.status(404).json({ error: "Tournament not found." });

  const full = summarizeTournament(db, tournament);
  res.json({ tournament: full });
});

app.post("/api/tournaments", auth, requireAdmin, (req, res) => {
  try {
    const db = readDb();
    const data = validateTournamentInput(req.body);

    const tournament = {
      id: id(),
      ...data,
      status: "registration",
      currentRound: 0,
      players: [],
      scores: {},
      pairHistory: [],
      createdBy: req.auth.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    db.tournaments.unshift(tournament);
    writeDb(db);

    res.status(201).json({
      message: "Tournament created.",
      tournament: summarizeTournament(db, tournament),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid request." });
  }
});

app.post("/api/tournaments/:id/join", auth, (req, res) => {
  if (req.auth.role !== "student") {
    return res
      .status(403)
      .json({ error: "Only students can join tournaments." });
  }

  const db = readDb();
  const tournament = getTournamentById(db, req.params.id);

  if (!tournament)
    return res.status(404).json({ error: "Tournament not found." });
  if (tournament.status !== "registration") {
    return res
      .status(400)
      .json({ error: "Tournament registration is closed." });
  }
  if (tournament.players.length >= tournament.maxPlayers) {
    return res.status(400).json({ error: "Tournament is full." });
  }

  const exists = tournament.players.some((p) => p.userId === req.auth.id);
  if (exists)
    return res
      .status(400)
      .json({ error: "You already joined this tournament." });

  tournament.players.push({
    userId: req.auth.id,
    joinedAt: nowIso(),
  });

  if (!tournament.scores) tournament.scores = {};
  tournament.scores[req.auth.id] = tournament.scores[req.auth.id] || 0;
  tournament.updatedAt = nowIso();

  writeDb(db);

  res.json({
    message: "Joined tournament.",
    tournament: summarizeTournament(db, tournament),
  });
});

app.post("/api/tournaments/:id/start-round", auth, requireAdmin, (req, res) => {
  const db = readDb();
  const tournament = getTournamentById(db, req.params.id);

  if (!tournament)
    return res.status(404).json({ error: "Tournament not found." });
  if (tournament.players.length < 2) {
    return res.status(400).json({ error: "Need at least 2 players." });
  }
  if (tournament.currentRound >= tournament.rounds) {
    return res.status(400).json({ error: "All rounds already completed." });
  }

  const unfinished = db.games.some(
    (g) => g.tournamentId === tournament.id && g.status !== "finished",
  );
  if (unfinished) {
    return res
      .status(400)
      .json({ error: "Finish current games before starting next round." });
  }

  const nextRound = tournament.currentRound + 1;
  const { pairings, bye } = nextRoundPairings(db, tournament);

  if (bye) {
    addScore(tournament, bye.userId, 1);
  }

  const newGames = pairings.map(([a, b], index) => {
    const whiteId = index % 2 === 0 ? a : b;
    const blackId = index % 2 === 0 ? b : a;

    tournament.pairHistory.push(pairKey(a, b));

    return {
      id: id(),
      tournamentId: tournament.id,
      round: nextRound,
      whiteId,
      blackId,
      fen: "start",
      pgn: "",
      moves: [],
      whiteMs: tournament.minutes * 60 * 1000,
      blackMs: tournament.minutes * 60 * 1000,
      incrementMs: tournament.increment * 1000,
      activeColor: "w",
      status: "active",
      result: "",
      finishReason: "",
      lastMoveAt: nowIso(),
      scored: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  });

  db.games.push(...newGames);

  tournament.currentRound = nextRound;
  tournament.status = "ongoing";
  tournament.updatedAt = nowIso();

  writeDb(db);

  res.json({
    message: bye
      ? `Round ${nextRound} started. ${getUserById(db, bye.userId)?.name || "A player"} got a bye.`
      : `Round ${nextRound} started.`,
    tournament: summarizeTournament(db, tournament),
    games: newGames.map((g) => summarizeGame(db, g)),
  });
});

app.get("/api/my-games", auth, (req, res) => {
  const db = readDb();

  for (const game of db.games) {
    settleTimeoutIfNeeded(db, game);
  }
  writeDb(db);

  let games = [];
  if (req.auth.role === "admin") {
    games = db.games;
  } else {
    games = db.games.filter(
      (g) => g.whiteId === req.auth.id || g.blackId === req.auth.id,
    );
  }

  games.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    games: games.map((g) => summarizeGame(db, g)),
  });
});

app.get("/api/admin/games", auth, requireAdmin, (req, res) => {
  const db = readDb();

  for (const game of db.games) {
    settleTimeoutIfNeeded(db, game);
  }
  writeDb(db);

  const games = db.games
    .map((g) => summarizeGame(db, g))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ games });
});

app.get("/api/games/:id", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game)) {
    return res.status(403).json({ error: "You cannot view this game." });
  }

  settleTimeoutIfNeeded(db, game);
  writeDb(db);

  res.json({ game: summarizeGame(db, game) });
});

app.post("/api/games/:id/move", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game)) {
    return res.status(403).json({ error: "You cannot play this game." });
  }
  if (req.auth.role !== "student") {
    return res.status(403).json({ error: "Admin cannot make moves." });
  }
  if (game.status !== "active") {
    return res.status(400).json({ error: "Game is not active." });
  }

  const isWhitePlayer = game.whiteId === req.auth.id;
  const isBlackPlayer = game.blackId === req.auth.id;

  if (!isWhitePlayer && !isBlackPlayer) {
    return res.status(403).json({ error: "Not your game." });
  }

  if (game.activeColor === "w" && !isWhitePlayer) {
    return res.status(400).json({ error: "It is white's turn." });
  }
  if (game.activeColor === "b" && !isBlackPlayer) {
    return res.status(400).json({ error: "It is black's turn." });
  }

  settleTimeoutIfNeeded(db, game);
  if (game.status !== "active") {
    writeDb(db);
    return res
      .status(400)
      .json({ error: "Time is over. Game already finished." });
  }

  const elapsed = Date.now() - new Date(game.lastMoveAt).getTime();

  if (game.activeColor === "w") {
    game.whiteMs = Math.max(0, game.whiteMs - elapsed);
    if (game.whiteMs <= 0) {
      game.status = "finished";
      game.result = "0-1";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      writeDb(db);
      return res.status(400).json({ error: "White lost on time." });
    }
  } else {
    game.blackMs = Math.max(0, game.blackMs - elapsed);
    if (game.blackMs <= 0) {
      game.status = "finished";
      game.result = "1-0";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      writeDb(db);
      return res.status(400).json({ error: "Black lost on time." });
    }
  }

  const chess = new Chess(game.fen === "start" ? undefined : game.fen);

  const from = String(req.body.from || "").trim();
  const to = String(req.body.to || "").trim();
  const promotion = String(req.body.promotion || "q").trim();

  const moverColor = game.activeColor;

  let move;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    move = null;
  }

  if (!move) {
    return res.status(400).json({ error: "Illegal move." });
  }

  if (moverColor === "w") {
    game.whiteMs += game.incrementMs;
  } else {
    game.blackMs += game.incrementMs;
  }

  game.fen = chess.fen();
  game.pgn = chess.pgn();
  game.moves.push({
    san: move.san,
    from: move.from,
    to: move.to,
    color: move.color,
    at: nowIso(),
  });

  game.activeColor = chess.turn();
  game.lastMoveAt = nowIso();
  game.updatedAt = nowIso();

  if (chess.isCheckmate()) {
    game.status = "finished";
    game.result = moverColor === "w" ? "1-0" : "0-1";
    game.finishReason = "checkmate";
    applyGameResult(db, game);
  } else if (
    chess.isDraw() ||
    chess.isStalemate() ||
    chess.isThreefoldRepetition() ||
    chess.isInsufficientMaterial()
  ) {
    game.status = "finished";
    game.result = "1/2-1/2";
    game.finishReason = "draw";
    applyGameResult(db, game);
  }

  writeDb(db);

  res.json({
    message: "Move played.",
    game: summarizeGame(db, game),
  });
});

app.post("/api/games/:id/resign", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game)) {
    return res.status(403).json({ error: "You cannot access this game." });
  }
  if (req.auth.role !== "student") {
    return res.status(403).json({ error: "Admin cannot resign games." });
  }
  if (game.status !== "active") {
    return res.status(400).json({ error: "Game already finished." });
  }

  if (game.whiteId === req.auth.id) {
    game.status = "finished";
    game.result = "0-1";
    game.finishReason = "resignation";
  } else if (game.blackId === req.auth.id) {
    game.status = "finished";
    game.result = "1-0";
    game.finishReason = "resignation";
  } else {
    return res.status(403).json({ error: "Not your game." });
  }

  applyGameResult(db, game);
  writeDb(db);

  res.json({
    message: "Game resigned.",
    game: summarizeGame(db, game),
  });
});

app.use((req, res) => {
  res
    .status(404)
    .json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => {
  ensureDb();
  console.log(`Server running on http://localhost:${PORT}`);
});
