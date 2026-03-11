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

// ─── HELPERS ────────────────────────────────────────────────────────────────

function id() {
  return crypto.randomBytes(8).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

// ─── DB ─────────────────────────────────────────────────────────────────────

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    const seed = {
      users: [
        {
          id: id(),
          name: "Admin",
          email: "admin@playchess.com",
          passwordHash: bcrypt.hashSync("admin123", 10),
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

// ─── AUTH ────────────────────────────────────────────────────────────────────

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
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth.role !== "admin")
    return res.status(403).json({ error: "Admin only." });
  next();
}

// ─── LOOKUP ──────────────────────────────────────────────────────────────────

function getUserById(db, userId) {
  return db.users.find((u) => u.id === userId);
}

function getTournamentById(db, tournamentId) {
  return db.tournaments.find((t) => t.id === tournamentId);
}

function getGameById(db, gameId) {
  return db.games.find((g) => g.id === gameId);
}

// ─── CHESS HELPERS ───────────────────────────────────────────────────────────

/**
 * Build a Chess instance from a stored FEN.
 * We store "start" for the initial position to keep it human-readable in the DB.
 */
function chessFromFen(fen) {
  return new Chess(fen === "start" || !fen ? undefined : fen);
}

// ─── SCORING ─────────────────────────────────────────────────────────────────

function getStandingScore(tournament, userId) {
  return tournament.scores?.[userId] ?? 0;
}

function addScore(tournament, userId, points) {
  if (!tournament.scores) tournament.scores = {};
  tournament.scores[userId] = (tournament.scores[userId] || 0) + points;
}

function applyGameResult(db, game) {
  // Guard: only score once
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

  // Check if all games in this round are now finished
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

// ─── TIMEOUT ─────────────────────────────────────────────────────────────────

/**
 * Check whether the active player has run out of time.
 * BUG FIX: Clock should NOT tick until the first move has been made.
 * We track this via game.clockStarted flag.
 * Returns true if the game was just finished by timeout.
 */
function settleTimeoutIfNeeded(db, game) {
  if (game.status !== "active") return false;
  // Clock hasn't started yet (no moves played)
  if (!game.clockStarted) return false;
  if (!game.lastMoveAt) return false;

  const elapsed = Date.now() - new Date(game.lastMoveAt).getTime();

  if (game.activeColor === "w") {
    if (game.whiteMs - elapsed <= 0) {
      game.whiteMs = 0;
      game.status = "finished";
      game.result = "0-1";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      game.updatedAt = nowIso();
      return true;
    }
  } else {
    if (game.blackMs - elapsed <= 0) {
      game.blackMs = 0;
      game.status = "finished";
      game.result = "1-0";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      game.updatedAt = nowIso();
      return true;
    }
  }

  return false;
}

// ─── PAIRING ─────────────────────────────────────────────────────────────────

function getPlayedSet(tournament) {
  const set = new Set(tournament.pairHistory || []);
  return set;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function nextRoundPairings(db, tournament) {
  const players = [...(tournament.players || [])].map((p) => ({
    ...p,
    score: getStandingScore(tournament, p.userId),
  }));

  players.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));

  const played = getPlayedSet(tournament);
  const pairings = [];
  const waiting = [...players];

  while (waiting.length > 1) {
    const p1 = waiting.shift();
    let index = waiting.findIndex(
      (p) => !played.has(pairKey(p1.userId, p.userId)),
    );
    // If everyone has played each other already, just pair in order
    if (index === -1) index = 0;
    const p2 = waiting.splice(index, 1)[0];
    pairings.push([p1.userId, p2.userId]);
  }

  // Odd player out gets a bye (only if they haven't had one)
  const byeCandidate = waiting[0] || null;
  let bye = null;
  if (byeCandidate) {
    const alreadyHadBye = (tournament.byeHistory || []).includes(
      byeCandidate.userId,
    );
    if (!alreadyHadBye) {
      bye = byeCandidate;
    } else {
      // They already had a bye — just pair them last resort or give another bye anyway
      bye = byeCandidate;
    }
  }

  return { pairings, bye };
}

// ─── SUMMARIES ───────────────────────────────────────────────────────────────

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

// ─── VALIDATION ──────────────────────────────────────────────────────────────

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

// ─── ROUTES ──────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── Auth ──

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
    if (!password || password.length < 4)
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters." });
    if (db.users.some((u) => u.email === email))
      return res.status(400).json({ error: "Email already in use." });

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
    return res
      .status(201)
      .json({ token: signToken(user), user: publicUser(user) });
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
    if (!user || !bcrypt.compareSync(password, user.passwordHash))
      return res.status(400).json({ error: "Invalid email or password." });
    return res.json({ token: signToken(user), user: publicUser(user) });
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

// ── Tournaments ──

app.get("/api/tournaments", (_req, res) => {
  const db = readDb();
  let dirty = false;
  for (const game of db.games) {
    if (settleTimeoutIfNeeded(db, game)) dirty = true;
  }
  if (dirty) writeDb(db);

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
  res.json({ tournament: summarizeTournament(db, tournament) });
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
      byeHistory: [], // FIX: track who got byes to prevent double-bye
      createdBy: req.auth.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.tournaments.unshift(tournament);
    writeDb(db);
    res
      .status(201)
      .json({
        message: "Tournament created.",
        tournament: summarizeTournament(db, tournament),
      });
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid request." });
  }
});

app.post("/api/tournaments/:id/join", auth, (req, res) => {
  if (req.auth.role !== "student")
    return res
      .status(403)
      .json({ error: "Only students can join tournaments." });

  const db = readDb();
  const tournament = getTournamentById(db, req.params.id);

  if (!tournament)
    return res.status(404).json({ error: "Tournament not found." });
  if (tournament.status !== "registration")
    return res.status(400).json({ error: "Registration is closed." });
  if (tournament.players.length >= tournament.maxPlayers)
    return res.status(400).json({ error: "Tournament is full." });
  if (tournament.players.some((p) => p.userId === req.auth.id))
    return res
      .status(400)
      .json({ error: "You already joined this tournament." });

  tournament.players.push({ userId: req.auth.id, joinedAt: nowIso() });
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
  if (tournament.players.length < 2)
    return res.status(400).json({ error: "Need at least 2 players." });
  if (tournament.currentRound >= tournament.rounds)
    return res.status(400).json({ error: "All rounds already completed." });

  // Check for any unfinished games from a previous round
  const unfinished = db.games.some(
    (g) => g.tournamentId === tournament.id && g.status !== "finished",
  );
  if (unfinished)
    return res
      .status(400)
      .json({
        error: "Finish all current games before starting the next round.",
      });

  const nextRound = tournament.currentRound + 1;
  const { pairings, bye } = nextRoundPairings(db, tournament);

  // FIX: award bye point and record it — only once per player if possible
  if (bye) {
    addScore(tournament, bye.userId, 1);
    if (!tournament.byeHistory) tournament.byeHistory = [];
    tournament.byeHistory.push(bye.userId);
  }

  const newGames = pairings.map(([a, b], index) => {
    // Alternate colors each round based on index
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
      // FIX: clockStarted = false so clocks don't tick until first move
      clockStarted: false,
      lastMoveAt: null,
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

  const byeUser = bye ? getUserById(db, bye.userId) : null;
  res.json({
    message: byeUser
      ? `Round ${nextRound} started. ${byeUser.name} receives a bye.`
      : `Round ${nextRound} started.`,
    tournament: summarizeTournament(db, tournament),
    games: newGames.map((g) => summarizeGame(db, g)),
  });
});

// FIX: Admin force-finish a stuck game
app.post(
  "/api/tournaments/:id/force-finish",
  auth,
  requireAdmin,
  (req, res) => {
    const db = readDb();
    const tournament = getTournamentById(db, req.params.id);
    if (!tournament)
      return res.status(404).json({ error: "Tournament not found." });

    const stuckGames = db.games.filter(
      (g) => g.tournamentId === tournament.id && g.status !== "finished",
    );

    for (const game of stuckGames) {
      game.status = "finished";
      game.result = "1/2-1/2";
      game.finishReason = "admin-force";
      game.updatedAt = nowIso();
      applyGameResult(db, game);
    }

    writeDb(db);
    res.json({
      message: `Force-finished ${stuckGames.length} game(s).`,
      tournament: summarizeTournament(db, tournament),
    });
  },
);

// ── Games ──

app.get("/api/my-games", auth, (req, res) => {
  const db = readDb();
  let dirty = false;
  for (const game of db.games) {
    if (settleTimeoutIfNeeded(db, game)) dirty = true;
  }
  if (dirty) writeDb(db);

  let games =
    req.auth.role === "admin"
      ? db.games
      : db.games.filter(
          (g) => g.whiteId === req.auth.id || g.blackId === req.auth.id,
        );

  games = [...games].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  res.json({ games: games.map((g) => summarizeGame(db, g)) });
});

app.get("/api/admin/games", auth, requireAdmin, (req, res) => {
  const db = readDb();
  let dirty = false;
  for (const game of db.games) {
    if (settleTimeoutIfNeeded(db, game)) dirty = true;
  }
  if (dirty) writeDb(db);

  const games = [...db.games]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((g) => summarizeGame(db, g));

  res.json({ games });
});

app.get("/api/games/:id", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });

  const changed = settleTimeoutIfNeeded(db, game);
  if (changed) writeDb(db);

  res.json({ game: summarizeGame(db, game) });
});

app.post("/api/games/:id/move", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });
  if (req.auth.role !== "student")
    return res.status(403).json({ error: "Admin cannot make moves." });
  if (game.status !== "active")
    return res.status(400).json({ error: "Game is not active." });

  const isWhite = game.whiteId === req.auth.id;
  const isBlack = game.blackId === req.auth.id;
  if (!isWhite && !isBlack)
    return res.status(403).json({ error: "Not your game." });
  if (game.activeColor === "w" && !isWhite)
    return res.status(400).json({ error: "It is white's turn." });
  if (game.activeColor === "b" && !isBlack)
    return res.status(400).json({ error: "It is black's turn." });

  // FIX: Start the clock on first move
  if (!game.clockStarted) {
    game.clockStarted = true;
    game.lastMoveAt = nowIso();
  }

  // Check timeout now that clock may have been ticking
  if (settleTimeoutIfNeeded(db, game)) {
    writeDb(db);
    return res
      .status(400)
      .json({ error: "Time is up. Game already finished." });
  }

  const now = Date.now();
  const elapsed = game.lastMoveAt
    ? now - new Date(game.lastMoveAt).getTime()
    : 0;

  // Deduct elapsed time from the mover's clock
  if (game.activeColor === "w") {
    game.whiteMs = Math.max(0, game.whiteMs - elapsed);
    if (game.whiteMs === 0) {
      game.status = "finished";
      game.result = "0-1";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      writeDb(db);
      return res.status(400).json({ error: "White ran out of time." });
    }
  } else {
    game.blackMs = Math.max(0, game.blackMs - elapsed);
    if (game.blackMs === 0) {
      game.status = "finished";
      game.result = "1-0";
      game.finishReason = "timeout";
      applyGameResult(db, game);
      writeDb(db);
      return res.status(400).json({ error: "Black ran out of time." });
    }
  }

  // FIX: Use chessFromFen helper consistently
  const chess = chessFromFen(game.fen);

  const from = String(req.body.from || "").trim();
  const to = String(req.body.to || "").trim();
  const promotion = String(req.body.promotion || "q")
    .trim()
    .toLowerCase();

  if (!from || !to)
    return res.status(400).json({ error: "from and to are required." });

  // FIX: validate promotion piece
  const validPromotions = ["q", "r", "b", "n"];
  const safePromotion = validPromotions.includes(promotion) ? promotion : "q";

  let move;
  try {
    move = chess.move({ from, to, promotion: safePromotion });
  } catch {
    move = null;
  }

  if (!move) return res.status(400).json({ error: "Illegal move." });

  // Add increment after a legal move
  if (game.activeColor === "w") {
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
    captured: move.captured || null,
    promotion: move.promotion || null,
    flags: move.flags,
    at: nowIso(),
  });

  game.activeColor = chess.turn();
  game.lastMoveAt = nowIso();
  game.updatedAt = nowIso();

  // Detect game-ending conditions
  if (chess.isCheckmate()) {
    game.status = "finished";
    game.result = game.activeColor === "w" ? "0-1" : "1-0"; // activeColor is now the NEXT player who is mated
    // FIX: result is for the mover: if white just mated black, activeColor flipped to b but white wins
    // Re-derive: the side that just moved (move.color) wins
    game.result = move.color === "w" ? "1-0" : "0-1";
    game.finishReason = "checkmate";
    applyGameResult(db, game);
  } else if (chess.isStalemate()) {
    game.status = "finished";
    game.result = "1/2-1/2";
    game.finishReason = "stalemate";
    applyGameResult(db, game);
  } else if (chess.isThreefoldRepetition()) {
    game.status = "finished";
    game.result = "1/2-1/2";
    game.finishReason = "threefold-repetition";
    applyGameResult(db, game);
  } else if (chess.isInsufficientMaterial()) {
    game.status = "finished";
    game.result = "1/2-1/2";
    game.finishReason = "insufficient-material";
    applyGameResult(db, game);
  } else if (chess.isDraw()) {
    // 50-move rule etc.
    game.status = "finished";
    game.result = "1/2-1/2";
    game.finishReason = "draw";
    applyGameResult(db, game);
  }

  writeDb(db);
  res.json({ message: "Move played.", game: summarizeGame(db, game) });
});

// FIX: Draw offer system
app.post("/api/games/:id/offer-draw", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });
  if (req.auth.role !== "student")
    return res.status(403).json({ error: "Admin cannot offer draws." });
  if (game.status !== "active")
    return res.status(400).json({ error: "Game is not active." });

  const isWhite = game.whiteId === req.auth.id;
  const isBlack = game.blackId === req.auth.id;
  if (!isWhite && !isBlack)
    return res.status(403).json({ error: "Not your game." });

  const offeredBy = isWhite ? "w" : "b";
  // Don't re-offer if you already offered
  if (game.drawOffer === offeredBy)
    return res.status(400).json({ error: "You already offered a draw." });

  game.drawOffer = offeredBy;
  game.updatedAt = nowIso();
  writeDb(db);

  res.json({ message: "Draw offered.", game: summarizeGame(db, game) });
});

app.post("/api/games/:id/accept-draw", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });
  if (req.auth.role !== "student")
    return res.status(403).json({ error: "Admin cannot accept draws." });
  if (game.status !== "active")
    return res.status(400).json({ error: "Game is not active." });

  const isWhite = game.whiteId === req.auth.id;
  const isBlack = game.blackId === req.auth.id;
  if (!isWhite && !isBlack)
    return res.status(403).json({ error: "Not your game." });

  const myColor = isWhite ? "w" : "b";
  if (!game.drawOffer || game.drawOffer === myColor)
    return res.status(400).json({ error: "No draw offer to accept." });

  game.status = "finished";
  game.result = "1/2-1/2";
  game.finishReason = "draw-agreement";
  game.drawOffer = null;
  applyGameResult(db, game);
  writeDb(db);

  res.json({ message: "Draw accepted.", game: summarizeGame(db, game) });
});

app.post("/api/games/:id/decline-draw", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });
  if (game.status !== "active")
    return res.status(400).json({ error: "Game is not active." });

  game.drawOffer = null;
  game.updatedAt = nowIso();
  writeDb(db);

  res.json({ message: "Draw declined.", game: summarizeGame(db, game) });
});

// FIX: Abort — only allowed if no moves have been played
app.post("/api/games/:id/abort", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });
  if (game.status !== "active")
    return res.status(400).json({ error: "Game is not active." });
  if (game.moves && game.moves.length > 0)
    return res
      .status(400)
      .json({ error: "Cannot abort a game that has started." });

  const isPlayer = game.whiteId === req.auth.id || game.blackId === req.auth.id;
  const isAdmin = req.auth.role === "admin";
  if (!isPlayer && !isAdmin)
    return res.status(403).json({ error: "Not your game." });

  game.status = "finished";
  game.result = "";
  game.finishReason = "aborted";
  game.updatedAt = nowIso();
  // No score change for aborted games
  writeDb(db);

  res.json({ message: "Game aborted.", game: summarizeGame(db, game) });
});

app.post("/api/games/:id/resign", auth, (req, res) => {
  const db = readDb();
  const game = getGameById(db, req.params.id);

  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!canAccessGame(req, game))
    return res.status(403).json({ error: "Access denied." });
  if (req.auth.role !== "student")
    return res.status(403).json({ error: "Admin cannot resign." });
  if (game.status !== "active")
    return res.status(400).json({ error: "Game already finished." });

  if (game.whiteId === req.auth.id) {
    game.result = "0-1";
  } else if (game.blackId === req.auth.id) {
    game.result = "1-0";
  } else {
    return res.status(403).json({ error: "Not your game." });
  }

  game.status = "finished";
  game.finishReason = "resignation";
  applyGameResult(db, game);
  writeDb(db);

  res.json({ message: "Resigned.", game: summarizeGame(db, game) });
});

// ── 404 ──

app.use((req, res) => {
  res
    .status(404)
    .json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Start ──

app.listen(PORT, () => {
  ensureDb();
  console.log(`✓ Server running on http://localhost:${PORT}`);
});
