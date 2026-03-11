import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
const TOKEN_KEY = "playchess_token";

// ─── API ────────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── UTILS ──────────────────────────────────────────────────────────────────

function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function formatMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getLiveClock(game, color) {
  if (!game) return 0;
  const key = color === "w" ? "whiteMs" : "blackMs";
  let ms = game[key] ?? 0;
  // FIX: don't tick until first move has been made
  if (
    game.status === "active" &&
    game.clockStarted &&
    game.activeColor === color &&
    game.lastMoveAt
  ) {
    ms -= Date.now() - new Date(game.lastMoveAt).getTime();
  }
  return Math.max(0, ms);
}

// Piece unicode for captured pieces display
const PIECE_UNICODE = {
  wP: "♙",
  wN: "♘",
  wB: "♗",
  wR: "♖",
  wQ: "♕",
  bP: "♟",
  bN: "♞",
  bB: "♝",
  bR: "♜",
  bQ: "♛",
};

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function getCapturedPieces(moves = []) {
  const captured = { w: [], b: [] };
  for (const m of moves) {
    if (m.captured) {
      // captured by color means the OTHER side lost it
      const loser = m.color === "w" ? "b" : "w";
      captured[m.color].push({ type: m.captured, color: loser });
    }
  }
  return captured;
}

function getMaterialAdvantage(captured) {
  const whiteVal = captured.w.reduce(
    (s, p) => s + (PIECE_VALUES[p.type] || 0),
    0,
  );
  const blackVal = captured.b.reduce(
    (s, p) => s + (PIECE_VALUES[p.type] || 0),
    0,
  );
  return { white: whiteVal - blackVal, black: blackVal - whiteVal };
}

// ─── SOUND ──────────────────────────────────────────────────────────────────

function createAudioContext() {
  try {
    return new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return null;
  }
}

function playMoveSound(type = "move") {
  const ctx = createAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === "capture") {
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } else if (type === "check") {
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } else if (type === "illegal") {
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } else {
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }
}

// ─── LAYOUT ─────────────────────────────────────────────────────────────────

function Layout({ user, setUser }) {
  const navigate = useNavigate();
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    navigate("/");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e8e6e3",
        fontFamily: "'Crimson Pro', Georgia, serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .nav-link { color: #a09880; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-family: 'JetBrains Mono', monospace; font-weight: 600; letter-spacing: 0.05em; transition: all 0.2s; border: 1px solid transparent; }
        .nav-link:hover { color: #e8e6e3; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); }
        .nav-link.active { color: #c9a84c; border-color: rgba(201,168,76,0.3); background: rgba(201,168,76,0.08); }
        .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; letter-spacing: 0.05em; cursor: pointer; transition: all 0.18s; border: 1px solid transparent; text-decoration: none; }
        .btn-primary { background: #c9a84c; color: #0a0a0f; border-color: #c9a84c; }
        .btn-primary:hover { background: #d4b860; }
        .btn-ghost { background: transparent; color: #a09880; border-color: rgba(255,255,255,0.12); }
        .btn-ghost:hover { background: rgba(255,255,255,0.06); color: #e8e6e3; border-color: rgba(255,255,255,0.2); }
        .btn-danger { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }
        .btn-danger:hover { background: #991b1b; }
        .btn-success { background: #14532d; color: #86efac; border-color: #166534; }
        .btn-success:hover { background: #166534; }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .card { background: #111118; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; }
        .input-field { width: 100%; background: #0d0d14; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px 16px; color: #e8e6e3; font-family: 'JetBrains Mono', monospace; font-size: 14px; outline: none; transition: border-color 0.2s; }
        .input-field:focus { border-color: #c9a84c; }
        .input-field::placeholder { color: #4a4a5a; }
        .badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-family: 'JetBrains Mono', monospace; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
        .badge-gold { background: rgba(201,168,76,0.15); color: #c9a84c; border: 1px solid rgba(201,168,76,0.3); }
        .badge-green { background: rgba(134,239,172,0.1); color: #86efac; border: 1px solid rgba(134,239,172,0.25); }
        .badge-blue { background: rgba(147,197,253,0.1); color: #93c5fd; border: 1px solid rgba(147,197,253,0.25); }
        .badge-red { background: rgba(252,165,165,0.1); color: #fca5a5; border: 1px solid rgba(252,165,165,0.25); }
        .badge-slate { background: rgba(148,163,184,0.08); color: #94a3b8; border: 1px solid rgba(148,163,184,0.15); }
        .move-pair { display: grid; grid-template-columns: 36px 1fr 1fr; gap: 2px; align-items: center; }
        .move-cell { padding: 5px 8px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 13px; cursor: pointer; transition: background 0.15s; }
        .move-cell:hover { background: rgba(255,255,255,0.08); }
        .move-cell.current { background: rgba(201,168,76,0.2); color: #c9a84c; }
        .clock { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .clock.active { color: #c9a84c; }
        .clock.low { color: #ef4444; animation: pulse-red 1s ease-in-out infinite; }
        @keyframes pulse-red { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
        .player-bar { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #0d0d14; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; }
        .player-bar.active-turn { border-color: rgba(201,168,76,0.4); background: rgba(201,168,76,0.04); }
        .result-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.75); border-radius: 8px; z-index: 10; backdrop-filter: blur(4px); }
        .premove-highlight { background: rgba(100,50,200,0.5) !important; }
        select.input-field option { background: #0d0d14; }
        textarea.input-field { min-height: 100px; resize: vertical; }
        .divider { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 0; }
        @keyframes slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: slide-in 0.25s ease forwards; }
        .captured-piece { font-size: 16px; opacity: 0.8; }
      `}</style>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 20px" }}>
        <header
          style={{
            padding: "16px 0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Link to="/" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 28, lineHeight: 1 }}>♟</span>
              <div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#e8e6e3",
                    letterSpacing: "-0.02em",
                  }}
                >
                  PlayChess
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#6b6b7a",
                    fontFamily: "JetBrains Mono, monospace",
                    letterSpacing: "0.1em",
                  }}
                >
                  TOURNAMENT PLATFORM
                </div>
              </div>
            </div>
          </Link>

          <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link to="/" className="nav-link">
              Tournaments
            </Link>
            {user ? (
              <>
                <Link to="/dashboard" className="nav-link active">
                  Dashboard
                </Link>
                <div
                  style={{
                    padding: "8px 14px",
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: 13,
                    fontFamily: "JetBrains Mono, monospace",
                    color: "#c9a84c",
                  }}
                >
                  {user.name} · {user.role}
                </div>
                <button
                  onClick={logout}
                  className="btn btn-ghost"
                  style={{ padding: "8px 14px" }}
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost">
                  Login
                </Link>
                <Link to="/register" className="btn btn-primary">
                  Register
                </Link>
              </>
            )}
          </nav>
        </header>

        <main style={{ padding: "32px 0 64px" }}>
          <Routes>
            <Route path="/" element={<PublicHome user={user} />} />
            <Route
              path="/tournaments/:id"
              element={<TournamentDetails user={user} />}
            />
            <Route
              path="/login"
              element={
                user ? (
                  <Navigate to="/dashboard" />
                ) : (
                  <LoginPage setUser={setUser} />
                )
              }
            />
            <Route
              path="/register"
              element={
                user ? (
                  <Navigate to="/dashboard" />
                ) : (
                  <RegisterPage setUser={setUser} />
                )
              }
            />
            <Route
              path="/dashboard"
              element={
                user ? (
                  user.role === "admin" ? (
                    <AdminDashboard user={user} />
                  ) : (
                    <StudentDashboard user={user} />
                  )
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/game/:id"
              element={
                user ? <GamePage user={user} /> : <Navigate to="/login" />
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

// ─── FIELD COMPONENTS ────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: 8,
          fontSize: 12,
          fontFamily: "JetBrains Mono, monospace",
          color: "#6b6b7a",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <Field label={label}>
      <input className="input-field" {...props} />
    </Field>
  );
}

function Textarea({ label, ...props }) {
  return (
    <Field label={label}>
      <textarea className="input-field" {...props} />
    </Field>
  );
}

function SelectField({ label, children, ...props }) {
  return (
    <Field label={label}>
      <select className="input-field" {...props}>
        {children}
      </select>
    </Field>
  );
}

function Alert({ type = "error", children }) {
  const styles = {
    error: {
      background: "rgba(127,29,29,0.3)",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#fca5a5",
    },
    success: {
      background: "rgba(20,83,45,0.3)",
      border: "1px solid rgba(34,197,94,0.3)",
      color: "#86efac",
    },
    info: {
      background: "rgba(30,58,138,0.3)",
      border: "1px solid rgba(59,130,246,0.3)",
      color: "#93c5fd",
    },
    warning: {
      background: "rgba(120,53,15,0.3)",
      border: "1px solid rgba(245,158,11,0.3)",
      color: "#fcd34d",
    },
  };
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        fontSize: 14,
        fontFamily: "JetBrains Mono, monospace",
        ...styles[type],
      }}
    >
      {children}
    </div>
  );
}

// ─── PUBLIC HOME ─────────────────────────────────────────────────────────────

function PublicHome({ user }) {
  const [tournaments, setTournaments] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/tournaments")
      .then((d) => setTournaments(d.tournaments || []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 300,
            letterSpacing: "-0.03em",
            color: "#e8e6e3",
            marginBottom: 8,
          }}
        >
          Active Tournaments
        </h1>
        <p
          style={{
            color: "#6b6b7a",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 13,
          }}
        >
          {user
            ? "Click any tournament to view details or join."
            : "Login required to join and play."}
        </p>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {!tournaments.length ? (
        <div
          style={{
            padding: "60px 0",
            textAlign: "center",
            color: "#4a4a5a",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          No tournaments yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {tournaments.map((t) => (
            <Link
              key={t.id}
              to={`/tournaments/${t.id}`}
              style={{ textDecoration: "none" }}
            >
              <div
                className="card"
                style={{
                  padding: "20px 24px",
                  transition: "border-color 0.2s, background 0.2s",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)";
                  e.currentTarget.style.background = "#13131e";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.background = "#111118";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 10,
                      }}
                    >
                      <span
                        className={`badge ${t.status === "registration" ? "badge-green" : t.status === "ongoing" ? "badge-blue" : "badge-slate"}`}
                      >
                        {t.status}
                      </span>
                      <span className="badge badge-gold">
                        {t.minutes}+{t.increment}
                      </span>
                      <span className="badge badge-slate">{t.format}</span>
                      <span className="badge badge-slate">{t.rounds}R</span>
                    </div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 600,
                        color: "#e8e6e3",
                        marginBottom: 6,
                      }}
                    >
                      {t.name}
                    </div>
                    <div style={{ fontSize: 14, color: "#6b6b7a" }}>
                      {t.description}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 12,
                      color: "#6b6b7a",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div>
                      {t.playerCount}/{t.maxPlayers} players
                    </div>
                    <div style={{ marginTop: 4 }}>
                      R{t.currentRound}/{t.rounds}
                    </div>
                    <div style={{ marginTop: 4 }}>{t.location}</div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TOURNAMENT DETAILS ───────────────────────────────────────────────────────

function TournamentDetails({ user }) {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/tournaments/${id}`);
      setTournament(data.tournament);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function join() {
    try {
      setError("");
      setMessage("");
      await api(`/api/tournaments/${id}/join`, { method: "POST" });
      setMessage("You have joined this tournament.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!tournament)
    return (
      <div
        style={{ color: "#6b6b7a", fontFamily: "JetBrains Mono, monospace" }}
      >
        {error || "Loading..."}
      </div>
    );

  const alreadyJoined = tournament.players?.some((p) => p.userId === user?.id);

  return (
    <div style={{ maxWidth: 900 }}>
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              className={`badge ${tournament.status === "registration" ? "badge-green" : tournament.status === "ongoing" ? "badge-blue" : "badge-slate"}`}
            >
              {tournament.status}
            </span>
            <span className="badge badge-gold">
              {tournament.minutes}+{tournament.increment}
            </span>
            <span className="badge badge-slate">{tournament.format}</span>
          </div>
          <h1
            style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}
          >
            {tournament.name}
          </h1>
        </div>
        {tournament.status === "registration" &&
          user?.role === "student" &&
          !alreadyJoined && (
            <button
              onClick={join}
              className="btn btn-primary"
              style={{ whiteSpace: "nowrap" }}
            >
              Join Tournament
            </button>
          )}
        {alreadyJoined && (
          <span className="badge badge-green">✓ Registered</span>
        )}
      </div>

      {message && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="error">{error}</Alert>
        </div>
      )}

      <p
        style={{
          color: "#a09880",
          marginBottom: 24,
          fontSize: 16,
          lineHeight: 1.6,
        }}
      >
        {tournament.description}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 32,
        }}
      >
        {[
          ["Location", tournament.location],
          ["Start", formatDate(tournament.startAt)],
          [
            "Players",
            `${tournament.players?.length || 0} / ${tournament.maxPlayers}`,
          ],
          ["Round", `${tournament.currentRound} / ${tournament.rounds}`],
        ].map(([k, v]) => (
          <div key={k} className="card" style={{ padding: "14px 18px" }}>
            <div
              style={{
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                color: "#6b6b7a",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
              }}
            >
              {k}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#e8e6e3" }}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {tournament.standings?.length > 0 && (
        <div className="card">
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              fontSize: 13,
              fontFamily: "JetBrains Mono, monospace",
              color: "#6b6b7a",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Standings
          </div>
          <div style={{ padding: "8px 0" }}>
            {tournament.standings.map((s, i) => (
              <div
                key={s.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 20px",
                  borderBottom:
                    i < tournament.standings.length - 1
                      ? "1px solid rgba(255,255,255,0.04)"
                      : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 13,
                      color: "#4a4a5a",
                      minWidth: 24,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 16, color: "#e8e6e3" }}>
                    {s.name}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 700,
                    fontSize: 18,
                    color: "#c9a84c",
                  }}
                >
                  {s.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────

function LoginPage({ setUser }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: "0 auto" }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>♟</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Welcome back
        </h1>
        <p style={{ color: "#6b6b7a", marginTop: 6, fontSize: 14 }}>
          Sign in to your account
        </p>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <form
          onSubmit={submit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {error && <Alert type="error">{error}</Alert>}
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            required
            placeholder="you@example.com"
          />
          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) =>
              setForm((p) => ({ ...p, password: e.target.value }))
            }
            required
            placeholder="••••••••"
          />
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "13px" }}
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "rgba(201,168,76,0.06)",
            border: "1px solid rgba(201,168,76,0.2)",
            borderRadius: 6,
            fontSize: 12,
            fontFamily: "JetBrains Mono, monospace",
            color: "#c9a84c",
          }}
        >
          Admin: admin@playchess.com / admin123
        </div>
      </div>

      <p
        style={{
          textAlign: "center",
          marginTop: 20,
          color: "#6b6b7a",
          fontSize: 14,
        }}
      >
        No account?{" "}
        <Link
          to="/register"
          style={{ color: "#c9a84c", textDecoration: "none" }}
        >
          Register
        </Link>
      </p>
    </div>
  );
}

function RegisterPage({ setUser }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    school: "",
    grade: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/register", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>♜</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Create account
        </h1>
        <p style={{ color: "#6b6b7a", marginTop: 6, fontSize: 14 }}>
          Join the tournament platform
        </p>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <form
          onSubmit={submit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {error && <Alert type="error">{error}</Alert>}
          <Input
            label="Full Name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            required
            placeholder="Your name"
          />
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
              required
              placeholder="you@example.com"
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm((p) => ({ ...p, password: e.target.value }))
              }
              required
              placeholder="Min. 4 chars"
            />
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <Input
              label="School"
              value={form.school}
              onChange={(e) =>
                setForm((p) => ({ ...p, school: e.target.value }))
              }
              placeholder="School name"
            />
            <Input
              label="Grade"
              value={form.grade}
              onChange={(e) =>
                setForm((p) => ({ ...p, grade: e.target.value }))
              }
              placeholder="e.g. 10"
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: 13 }}
            disabled={loading}
          >
            {loading ? "Creating…" : "Create Account"}
          </button>
        </form>
      </div>

      <p
        style={{
          textAlign: "center",
          marginTop: 20,
          color: "#6b6b7a",
          fontSize: 14,
        }}
      >
        Have an account?{" "}
        <Link to="/login" style={{ color: "#c9a84c", textDecoration: "none" }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

// ─── DASHBOARDS ───────────────────────────────────────────────────────────────

function GameCard({ g }) {
  return (
    <Link to={`/game/${g.id}`} style={{ textDecoration: "none" }}>
      <div
        className="card"
        style={{
          padding: "16px 20px",
          transition: "all 0.18s",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)";
          e.currentTarget.style.background = "#13131e";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
          e.currentTarget.style.background = "#111118";
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                className={`badge ${g.status === "active" ? "badge-green" : g.status === "finished" ? "badge-slate" : "badge-blue"}`}
              >
                {g.status}
              </span>
              <span className="badge badge-gold">R{g.round}</span>
              {g.result && (
                <span className="badge badge-slate">{g.result}</span>
              )}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {g.whiteName} <span style={{ color: "#4a4a5a" }}>vs</span>{" "}
              {g.blackName}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#6b6b7a",
                marginTop: 4,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {g.tournamentName} · {g.timeControl}
            </div>
          </div>
          <span style={{ fontSize: 28, opacity: 0.3 }}>→</span>
        </div>
      </div>
    </Link>
  );
}

function StudentDashboard({ user }) {
  const [myGames, setMyGames] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [gData, tData] = await Promise.all([
        api("/api/my-games"),
        api("/api/tournaments"),
      ]);
      setMyGames(gData.games || []);
      setTournaments(tData.tournaments || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const joinedIds = useMemo(
    () =>
      new Set(
        tournaments
          .filter((t) => t.players?.some((p) => p.userId === user.id))
          .map((t) => t.id),
      ),
    [tournaments, user.id],
  );

  const activeGames = myGames.filter((g) => g.status === "active");
  const finishedGames = myGames.filter((g) => g.status !== "active");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 300px",
        gap: 24,
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {error && <Alert type="error">{error}</Alert>}

        <section>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 600,
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            Active Games
            {activeGames.length > 0 && (
              <span className="badge badge-green">{activeGames.length}</span>
            )}
          </h2>
          {!activeGames.length ? (
            <p
              style={{
                color: "#4a4a5a",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13,
              }}
            >
              No active games.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeGames.map((g) => (
                <GameCard key={g.id} g={g} />
              ))}
            </div>
          )}
        </section>

        {finishedGames.length > 0 && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 14 }}>
              Recent Games
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {finishedGames.slice(0, 8).map((g) => (
                <GameCard key={g.id} g={g} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card">
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              color: "#6b6b7a",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            My Tournaments
          </div>
          <div style={{ padding: "8px 0" }}>
            {!tournaments.some((t) => joinedIds.has(t.id)) ? (
              <div
                style={{
                  padding: "16px 18px",
                  color: "#4a4a5a",
                  fontSize: 13,
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                Not in any tournament yet.
              </div>
            ) : (
              tournaments
                .filter((t) => joinedIds.has(t.id))
                .map((t, i, arr) => (
                  <div
                    key={t.id}
                    style={{
                      padding: "12px 18px",
                      borderBottom:
                        i < arr.length - 1
                          ? "1px solid rgba(255,255,255,0.04)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        className={`badge ${t.status === "registration" ? "badge-green" : t.status === "ongoing" ? "badge-blue" : "badge-slate"}`}
                      >
                        {t.status}
                      </span>
                      <span className="badge badge-gold">
                        {t.minutes}+{t.increment}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                      {t.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6b6b7a",
                        marginTop: 4,
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      R{t.currentRound}/{t.rounds}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <div
            style={{
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              color: "#6b6b7a",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Quick Links
          </div>
          <Link
            to="/"
            className="btn btn-ghost"
            style={{
              width: "100%",
              justifyContent: "flex-start",
              marginBottom: 8,
            }}
          >
            Browse Tournaments →
          </Link>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [tournaments, setTournaments] = useState([]);
  const [games, setGames] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("games");

  const [form, setForm] = useState({
    name: "",
    description: "",
    location: "",
    format: "swiss",
    rounds: 5,
    minutes: 3,
    increment: 2,
    maxPlayers: 32,
    startAt: "",
  });

  const load = useCallback(async () => {
    try {
      const [tData, gData] = await Promise.all([
        api("/api/tournaments"),
        api("/api/admin/games"),
      ]);
      setTournaments(tData.tournaments || []);
      setGames(gData.games || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  async function createTournament(e) {
    e.preventDefault();
    try {
      setError("");
      setMessage("");
      await api("/api/tournaments", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          rounds: +form.rounds,
          minutes: +form.minutes,
          increment: +form.increment,
          maxPlayers: +form.maxPlayers,
        }),
      });
      setMessage("Tournament created.");
      setForm({
        name: "",
        description: "",
        location: "",
        format: "swiss",
        rounds: 5,
        minutes: 3,
        increment: 2,
        maxPlayers: 32,
        startAt: "",
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function startRound(id) {
    try {
      setError("");
      setMessage("");
      const data = await api(`/api/tournaments/${id}/start-round`, {
        method: "POST",
      });
      setMessage(data.message || "Round started.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const tabs = [
    {
      id: "games",
      label: `Live Games (${games.filter((g) => g.status === "active").length})`,
    },
    { id: "tournaments", label: `Tournaments (${tournaments.length})` },
    { id: "create", label: "Create Tournament" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <div
        style={{
          display: "flex",
          gap: 4,
          background: "#0d0d14",
          padding: 4,
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.08)",
          width: "fit-content",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="btn"
            style={{
              background:
                activeTab === t.id ? "rgba(201,168,76,0.15)" : "transparent",
              color: activeTab === t.id ? "#c9a84c" : "#6b6b7a",
              border:
                activeTab === t.id
                  ? "1px solid rgba(201,168,76,0.3)"
                  : "1px solid transparent",
              padding: "8px 16px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "games" && (
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
            All Games Monitor
          </h2>
          {!games.length ? (
            <p
              style={{
                color: "#4a4a5a",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13,
              }}
            >
              No games yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {games.map((g) => (
                <GameCard key={g.id} g={g} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "tournaments" && (
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
            Manage Tournaments
          </h2>
          {!tournaments.length ? (
            <p
              style={{
                color: "#4a4a5a",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13,
              }}
            >
              No tournaments yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {tournaments.map((t) => (
                <div
                  key={t.id}
                  className="card"
                  style={{ padding: "20px 24px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          marginBottom: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          className={`badge ${t.status === "registration" ? "badge-green" : t.status === "ongoing" ? "badge-blue" : "badge-slate"}`}
                        >
                          {t.status}
                        </span>
                        <span className="badge badge-gold">
                          {t.minutes}+{t.increment}
                        </span>
                        <span className="badge badge-slate">
                          R{t.currentRound}/{t.rounds}
                        </span>
                        <span className="badge badge-slate">{t.format}</span>
                      </div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          marginBottom: 4,
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#6b6b7a",
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {t.playerCount}/{t.maxPlayers} players ·{" "}
                        {formatDate(t.startAt)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => startRound(t.id)}
                        className="btn btn-success"
                      >
                        {t.currentRound === 0 ? "▶ Start R1" : "▶ Next Round"}
                      </button>
                      <Link
                        to={`/tournaments/${t.id}`}
                        className="btn btn-ghost"
                      >
                        View →
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "create" && (
        <div style={{ maxWidth: 700 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>
            New Tournament
          </h2>
          <div className="card" style={{ padding: 28 }}>
            <form
              onSubmit={createTournament}
              style={{ display: "flex", flexDirection: "column", gap: 18 }}
            >
              <Input
                label="Tournament Name"
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
                required
                placeholder="e.g. Spring Championship 2025"
              />
              <Textarea
                label="Description"
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Brief description..."
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <Input
                  label="Location"
                  value={form.location}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, location: e.target.value }))
                  }
                  required
                  placeholder="City / Venue"
                />
                <SelectField
                  label="Format"
                  value={form.format}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, format: e.target.value }))
                  }
                >
                  <option value="swiss">Swiss</option>
                  <option value="round-robin">Round Robin</option>
                </SelectField>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 14,
                }}
              >
                <Input
                  label="Rounds"
                  type="number"
                  min="1"
                  value={form.rounds}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, rounds: e.target.value }))
                  }
                  required
                />
                <Input
                  label="Max Players"
                  type="number"
                  min="2"
                  value={form.maxPlayers}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, maxPlayers: e.target.value }))
                  }
                  required
                />
                <Input
                  label="Minutes"
                  type="number"
                  min="1"
                  value={form.minutes}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, minutes: e.target.value }))
                  }
                  required
                />
                <Input
                  label="Increment (s)"
                  type="number"
                  min="0"
                  value={form.increment}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, increment: e.target.value }))
                  }
                  required
                />
              </div>
              <Input
                label="Start Date & Time"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) =>
                  setForm((p) => ({ ...p, startAt: e.target.value }))
                }
                required
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "rgba(201,168,76,0.06)",
                  border: "1px solid rgba(201,168,76,0.2)",
                  borderRadius: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: "JetBrains Mono, monospace",
                      color: "#6b6b7a",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Time Control Preview
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontFamily: "JetBrains Mono, monospace",
                      fontWeight: 700,
                      color: "#c9a84c",
                      marginTop: 4,
                    }}
                  >
                    {form.minutes}+{form.increment}
                  </div>
                </div>
                <button className="btn btn-primary">Create Tournament →</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GAME PAGE — full replacement ───────────────────────────────────────────
// Drop this entire block in place of the GamePage function + its helpers
// (CapturedPieces, Clock, MoveHistory) in App.jsx

function CapturedPieces({ pieces, advantage }) {
  const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
  const sorted = [...pieces].sort(
    (a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9),
  );
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2, minHeight: 20 }}
    >
      {sorted.map((p, i) => (
        <span
          key={i}
          style={{
            fontSize: 14,
            lineHeight: 1,
            opacity: 0.85,
            color: p.color === "w" ? "#f0d9b5" : "#5a3a1a",
          }}
        >
          {PIECE_UNICODE[`${p.color}${p.type.toUpperCase()}`] || p.type}
        </span>
      ))}
      {advantage > 0 && (
        <span
          style={{
            fontSize: 11,
            fontFamily: "JetBrains Mono, monospace",
            color: "#c9a84c",
            marginLeft: 4,
          }}
        >
          +{advantage}
        </span>
      )}
    </div>
  );
}

function Clock({ ms, active, lowThreshold = 10 }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  const isLow = total <= lowThreshold && active;
  const isCritical = total <= 5 && active;

  return (
    <div
      style={{
        fontFamily: "JetBrains Mono, monospace",
        fontVariantNumeric: "tabular-nums",
        fontSize: 38,
        fontWeight: 700,
        letterSpacing: "-0.03em",
        lineHeight: 1,
        color: isCritical
          ? "#ef4444"
          : isLow
            ? "#f59e0b"
            : active
              ? "#c9a84c"
              : "#4a4a5a",
        transition: "color 0.3s",
        animation: isCritical ? "pulse-red 0.8s ease-in-out infinite" : "none",
        minWidth: 110,
        textAlign: "right",
      }}
    >
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      {total < 20 && (
        <span style={{ fontSize: 20, opacity: 0.7 }}>.{tenths}</span>
      )}
    </div>
  );
}

function MoveHistory({ moves, currentIndex, onSelect }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector(".move-cell.current");
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      n: Math.floor(i / 2) + 1,
      w: moves[i],
      b: moves[i + 1],
      wi: i,
      bi: i + 1,
    });
  }

  return (
    <div
      ref={listRef}
      style={{ height: 260, overflowY: "auto", padding: "4px 0" }}
    >
      {!pairs.length ? (
        <div
          style={{
            padding: "12px 16px",
            color: "#3a3a4a",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
          }}
        >
          No moves yet
        </div>
      ) : (
        pairs.map(({ n, w, b, wi, bi }) => (
          <div
            key={n}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 1fr",
              gap: 1,
            }}
          >
            <span
              style={{
                padding: "4px 6px",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                color: "#3a3a4a",
                lineHeight: "22px",
                textAlign: "right",
              }}
            >
              {n}.
            </span>
            <button
              className={`move-cell${currentIndex === wi ? " current" : ""}`}
              onClick={() => onSelect(wi)}
              style={{
                all: "unset",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "JetBrains Mono, monospace",
                borderRadius: 3,
                color: currentIndex === wi ? "#c9a84c" : "#c8c5c0",
                background:
                  currentIndex === wi ? "rgba(201,168,76,0.15)" : "transparent",
                transition: "background 0.1s",
              }}
            >
              {w?.san}
            </button>
            {b && (
              <button
                className={`move-cell${currentIndex === bi ? " current" : ""}`}
                onClick={() => onSelect(bi)}
                style={{
                  all: "unset",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "JetBrains Mono, monospace",
                  borderRadius: 3,
                  color: currentIndex === bi ? "#c9a84c" : "#c8c5c0",
                  background:
                    currentIndex === bi
                      ? "rgba(201,168,76,0.15)"
                      : "transparent",
                  transition: "background 0.1s",
                }}
              >
                {b?.san}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function GamePage({ user }) {
  const { id } = useParams();

  // ── State ──
  const [game, setGame] = useState(null);
  const [error, setError] = useState("");
  const [whiteMs, setWhiteMs] = useState(0);
  const [blackMs, setBlackMs] = useState(0);
  const [moveIndex, setMoveIndex] = useState(-1);
  const [viewFen, setViewFen] = useState(null); // null = live
  const [selectedSq, setSelectedSq] = useState(null);
  const [legalDots, setLegalDots] = useState({});
  const [premove, setPremove] = useState(null); // { from, to }
  const [promoData, setPromoData] = useState(null); // { from, to }
  const [promoPiece, setPromoPiece] = useState("q");
  const [lastMove, setLastMove] = useState(null); // { from, to }
  const [isMoving, setIsMoving] = useState(false);

  // dialogs
  const [resignConfirm, setResignConfirm] = useState(false);
  const [drawSent, setDrawSent] = useState(false);
  const [notification, setNotification] = useState(null); // { type, text }

  const rafRef = useRef(null);
  const gameRef = useRef(null);
  gameRef.current = game;

  // ── Notify helper ──
  function notify(type, text, ms = 4000) {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), ms);
  }

  // ── RAF clock ──
  useEffect(() => {
    let last = Date.now();
    function tick() {
      const g = gameRef.current;
      const now = Date.now();
      const delta = now - last;
      last = now;
      if (g?.status === "active" && g.clockStarted) {
        if (g.activeColor === "w") setWhiteMs((p) => Math.max(0, p - delta));
        else setBlackMs((p) => Math.max(0, p - delta));
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Load ──
  const load = useCallback(
    async (silent = false) => {
      try {
        const data = await api(`/api/games/${id}`);
        const g = data.game;
        const prevGame = gameRef.current;

        setGame(g);
        setWhiteMs(getLiveClock(g, "w"));
        setBlackMs(getLiveClock(g, "b"));

        if (g.moves?.length > 0) {
          const last = g.moves[g.moves.length - 1];
          setLastMove({ from: last.from, to: last.to });
        }

        // Only update moveIndex if not browsing history
        setMoveIndex((idx) => {
          const live = g.moves?.length - 1 ?? -1;
          if (viewFen === null) return live; // stay at live end
          return idx; // keep user's position
        });

        // Detect incoming draw offer
        if (!silent && g.drawOffer && prevGame && !prevGame.drawOffer) {
          const offererColor = g.drawOffer;
          const offererName = offererColor === "w" ? g.whiteName : g.blackName;
          const myColor =
            g.whiteId === user.id ? "w" : g.blackId === user.id ? "b" : null;
          if (myColor && myColor !== offererColor) {
            notify("info", `${offererName} offers a draw.`, 8000);
          }
        }

        // Clear premove if it was played or game ended
        setPremove((prev) => {
          if (!prev) return null;
          if (g.status !== "active") return null;
          return prev;
        });
      } catch (err) {
        if (!silent) setError(err.message);
      }
    },
    [id, user.id, viewFen],
  );

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 1200);
    return () => clearInterval(iv);
  }, [load]);

  // ── Execute premove when it's our turn ──
  useEffect(() => {
    if (!premove || !game || !canPlay) return;
    const pm = premove;
    setPremove(null);
    executeMove(pm.from, pm.to, "q");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.activeColor, game?.moves?.length]);

  // ── Keyboard nav ──
  useEffect(() => {
    function onKey(e) {
      if (!game?.moves) return;
      if (e.key === "ArrowLeft") goToMove(moveIndex - 1);
      if (e.key === "ArrowRight") goToMove(moveIndex + 1);
      if (e.key === "ArrowUp") goToMove(0);
      if (e.key === "ArrowDown") goToLive();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveIndex, game]);

  // ── Derived ──
  const myColor = useMemo(() => {
    if (!game || user.role !== "student") return null;
    if (game.whiteId === user.id) return "w";
    if (game.blackId === user.id) return "b";
    return null;
  }, [game, user]);

  const canPlay = useMemo(
    () =>
      !!myColor &&
      game?.status === "active" &&
      game?.activeColor === myColor &&
      viewFen === null,
    [myColor, game, viewFen],
  );

  const isViewingHistory = viewFen !== null;
  const displayFen =
    viewFen ??
    (game?.fen === "start"
      ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
      : game?.fen) ??
    "start";

  const captured = useMemo(
    () => getCapturedPieces(game?.moves || []),
    [game?.moves],
  );
  const material = useMemo(() => getMaterialAdvantage(captured), [captured]);

  const boardOrientation = myColor === "b" ? "black" : "white";

  const topColor = boardOrientation === "white" ? "b" : "w";
  const bottomColor = boardOrientation === "white" ? "w" : "b";

  const topPlayer = {
    name: topColor === "w" ? game?.whiteName : game?.blackName,
    color: topColor,
    ms: topColor === "w" ? whiteMs : blackMs,
    active: game?.activeColor === topColor && game?.status === "active",
    captured: captured[topColor === "w" ? "b" : "w"], // pieces opponent captured = pieces we lost
    material: topColor === "w" ? material.white : material.black,
  };
  const bottomPlayer = {
    name: bottomColor === "w" ? game?.whiteName : game?.blackName,
    color: bottomColor,
    ms: bottomColor === "w" ? whiteMs : blackMs,
    active: game?.activeColor === bottomColor && game?.status === "active",
    captured: captured[bottomColor === "w" ? "b" : "w"],
    material: bottomColor === "w" ? material.white : material.black,
  };

  // ── Custom square styles ──
  const customSquareStyles = useMemo(() => {
    const s = {};
    if (lastMove && !isViewingHistory) {
      s[lastMove.from] = { background: "rgba(172,140,60,0.35)" };
      s[lastMove.to] = { background: "rgba(172,140,60,0.5)" };
    }
    if (selectedSq) {
      s[selectedSq] = { background: "rgba(201,168,76,0.6)" };
    }
    Object.assign(s, legalDots);
    if (premove) {
      s[premove.from] = { background: "rgba(110,60,210,0.45)" };
      s[premove.to] = { background: "rgba(110,60,210,0.55)" };
    }
    // highlight king in check
    if (game && game.status === "active" && !isViewingHistory) {
      try {
        const chess = new Chess(game.fen === "start" ? undefined : game.fen);
        if (chess.inCheck()) {
          const board = chess.board();
          for (const row of board) {
            for (const sq of row) {
              if (sq && sq.type === "k" && sq.color === chess.turn()) {
                const file = "abcdefgh"[
                  sq.square ? sq.square.charCodeAt(0) - 97 : 0
                ];
                s[sq.square] = {
                  background:
                    "radial-gradient(circle, rgba(239,68,68,0.8) 40%, rgba(239,68,68,0.2) 70%, transparent)",
                };
              }
            }
          }
        }
      } catch {}
    }
    return s;
  }, [lastMove, selectedSq, legalDots, premove, game, isViewingHistory]);

  // ── Compute legal move dots ──
  function computeLegalDots(fen, square) {
    try {
      const chess = new Chess(fen === "start" ? undefined : fen);
      const moves = chess.moves({ square, verbose: true });
      const map = {};
      for (const m of moves) {
        const isCapture = !!m.captured;
        map[m.to] = isCapture
          ? {
              background:
                "radial-gradient(circle, transparent 58%, rgba(201,168,76,0.65) 58%)",
            }
          : {
              background:
                "radial-gradient(circle, rgba(201,168,76,0.55) 26%, transparent 27%)",
            };
      }
      return map;
    } catch {
      return {};
    }
  }

  // ── Click to move ──
  function onSquareClick(square) {
    if (isViewingHistory) return;

    // Not your turn → set premove
    if (!canPlay && myColor && game?.status === "active") {
      if (selectedSq && selectedSq !== square) {
        setPremove({ from: selectedSq, to: square });
        setSelectedSq(null);
        setLegalDots({});
        notify("info", "Premove set — will play when it's your turn.", 2000);
        return;
      }
      setSelectedSq(square);
      return;
    }

    if (!canPlay) return;
    if (isMoving) return;

    const chess = new Chess(game.fen === "start" ? undefined : game.fen);
    const piece = chess.get(square);

    if (selectedSq) {
      if (legalDots[square] !== undefined) {
        // check promotion
        const p = chess.get(selectedSq);
        if (
          p?.type === "p" &&
          ((myColor === "w" && square[1] === "8") ||
            (myColor === "b" && square[1] === "1"))
        ) {
          setPromoData({ from: selectedSq, to: square });
          setSelectedSq(null);
          setLegalDots({});
          return;
        }
        executeMove(selectedSq, square, "q");
        setSelectedSq(null);
        setLegalDots({});
      } else if (piece && piece.color === myColor) {
        setSelectedSq(square);
        setLegalDots(computeLegalDots(game.fen, square));
      } else {
        setSelectedSq(null);
        setLegalDots({});
      }
    } else {
      if (piece && piece.color === myColor) {
        setSelectedSq(square);
        setLegalDots(computeLegalDots(game.fen, square));
      }
    }
  }

  // ── Drag ──
  function onDragStart(piece, square) {
    if (!canPlay && !(!canPlay && myColor && game?.status === "active"))
      return false;
    if (piece[0] !== myColor) return false;
    if (canPlay) {
      setSelectedSq(square);
      setLegalDots(computeLegalDots(game.fen, square));
    }
    return true;
  }

  async function onDrop(from, to) {
    setSelectedSq(null);
    setLegalDots({});

    // Premove
    if (!canPlay && myColor && game?.status === "active") {
      setPremove({ from, to });
      notify("info", "Premove set.", 1500);
      return true; // return true to allow the visual snap-back correctly
    }

    if (!canPlay || isMoving) return false;

    const chess = new Chess(game.fen === "start" ? undefined : game.fen);
    const p = chess.get(from);
    if (
      p?.type === "p" &&
      ((myColor === "w" && to[1] === "8") || (myColor === "b" && to[1] === "1"))
    ) {
      setPromoData({ from, to });
      return false;
    }
    return executeMove(from, to, "q");
  }

  // ── Execute move ──
  async function executeMove(from, to, promotion) {
    if (isMoving) return false;
    if (!game || game.status !== "active") return false;
    setIsMoving(true);

    // Optimistic update
    try {
      const chess = new Chess(game.fen === "start" ? undefined : game.fen);
      const result = chess.move({ from, to, promotion });
      if (!result) {
        playMoveSound("illegal");
        setIsMoving(false);
        return false;
      }

      playMoveSound(
        result.captured ? "capture" : chess.inCheck() ? "check" : "move",
      );

      const optimistic = {
        ...game,
        fen: chess.fen(),
        clockStarted: true,
        moves: [
          ...(game.moves || []),
          {
            san: result.san,
            from,
            to,
            color: result.color,
            captured: result.captured || null,
            promotion: result.promotion || null,
            flags: result.flags,
            at: new Date().toISOString(),
          },
        ],
        activeColor: chess.turn(),
        lastMoveAt: new Date().toISOString(),
      };
      setGame(optimistic);
      setLastMove({ from, to });
      setMoveIndex(optimistic.moves.length - 1);

      const data = await api(`/api/games/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ from, to, promotion }),
      });
      setGame(data.game);
      setWhiteMs(getLiveClock(data.game, "w"));
      setBlackMs(getLiveClock(data.game, "b"));
      setIsMoving(false);
      return true;
    } catch (err) {
      playMoveSound("illegal");
      setError(err.message);
      setTimeout(() => setError(""), 3000);
      load(true);
      setIsMoving(false);
      return false;
    }
  }

  // ── Actions ──
  async function resign() {
    setResignConfirm(false);
    try {
      const data = await api(`/api/games/${id}/resign`, { method: "POST" });
      setGame(data.game);
      notify("info", "You resigned.");
    } catch (err) {
      notify("error", err.message);
    }
  }

  async function offerDraw() {
    try {
      await api(`/api/games/${id}/offer-draw`, { method: "POST" });
      setDrawSent(true);
      notify("info", "Draw offer sent.");
      setTimeout(() => setDrawSent(false), 10000);
    } catch (err) {
      notify("error", err.message);
    }
  }

  async function acceptDraw() {
    try {
      const data = await api(`/api/games/${id}/accept-draw`, {
        method: "POST",
      });
      setGame(data.game);
    } catch (err) {
      notify("error", err.message);
    }
  }

  async function declineDraw() {
    try {
      await api(`/api/games/${id}/decline-draw`, { method: "POST" });
      setGame((g) => (g ? { ...g, drawOffer: null } : g));
    } catch (err) {
      notify("error", err.message);
    }
  }

  async function abortGame() {
    try {
      const data = await api(`/api/games/${id}/abort`, { method: "POST" });
      setGame(data.game);
      notify("info", "Game aborted.");
    } catch (err) {
      notify("error", err.message);
    }
  }

  // ── History nav ──
  function goToMove(index) {
    if (!game?.moves) return;
    const clamped = Math.max(-1, Math.min(game.moves.length - 1, index));
    if (
      clamped === game.moves.length - 1 ||
      (clamped === -1 && game.moves.length === 0)
    ) {
      goToLive();
      return;
    }
    if (clamped < 0) {
      setViewFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      setMoveIndex(-1);
      return;
    }
    const chess = new Chess();
    for (let i = 0; i <= clamped; i++) {
      const m = game.moves[i];
      try {
        chess.move({ from: m.from, to: m.to, promotion: m.promotion || "q" });
      } catch {}
    }
    setViewFen(chess.fen());
    setMoveIndex(clamped);
  }

  function goToLive() {
    setViewFen(null);
    setMoveIndex(game?.moves?.length ? game.moves.length - 1 : -1);
  }

  // ── Promotion confirm ──
  function confirmPromotion(piece) {
    if (!promoData) return;
    const { from, to } = promoData;
    setPromoData(null);
    setPromoPiece("q");
    executeMove(from, to, piece);
  }

  // ── Draw offer from opponent ──
  const pendingDrawFromOpponent = useMemo(() => {
    if (!game || !myColor || !game.drawOffer) return false;
    return game.drawOffer !== myColor;
  }, [game, myColor]);

  // ── Loading ──
  if (!game) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: 400,
          gap: 16,
        }}
      >
        {error ? (
          <div
            style={{
              padding: "12px 20px",
              background: "rgba(127,29,29,0.3)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              borderRadius: 8,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        ) : (
          <div
            style={{
              color: "#3a3a4a",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
            }}
          >
            Loading game…
          </div>
        )}
      </div>
    );
  }

  const resultLabel =
    game.result === "1-0"
      ? `${game.whiteName} wins`
      : game.result === "0-1"
        ? `${game.blackName} wins`
        : game.result === "1/2-1/2"
          ? "Draw"
          : "";

  const canAbort =
    game.status === "active" &&
    (!game.moves || game.moves.length === 0) &&
    myColor;
  const canResign = game.status === "active" && myColor;
  const canOfferDraw =
    game.status === "active" && myColor && !drawSent && !game.drawOffer;

  return (
    <div
      style={{
        display: "flex",
        gap: 20,
        alignItems: "flex-start",
        maxWidth: 1140,
      }}
    >
      {/* ══ BOARD COLUMN ══ */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* Top player bar */}
        <PlayerBar
          player={topPlayer}
          isActive={topPlayer.active && !isViewingHistory}
        />

        {/* Board wrapper */}
        <div style={{ position: "relative" }}>
          {/* Notifications strip */}
          {notification && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 30,
                padding: "8px 16px",
                textAlign: "center",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: 600,
                background:
                  notification.type === "error"
                    ? "rgba(127,29,29,0.95)"
                    : notification.type === "info"
                      ? "rgba(30,58,138,0.95)"
                      : "rgba(20,83,45,0.95)",
                color:
                  notification.type === "error"
                    ? "#fca5a5"
                    : notification.type === "info"
                      ? "#93c5fd"
                      : "#86efac",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {notification.text}
            </div>
          )}

          {/* History banner */}
          {isViewingHistory && (
            <div
              style={{
                position: "absolute",
                bottom: 8,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 25,
                background: "rgba(201,168,76,0.95)",
                color: "#0a0a0f",
                padding: "4px 16px",
                borderRadius: 20,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              ← BROWSING HISTORY · ↓ LIVE
            </div>
          )}

          {/* Result overlay */}
          {game.status === "finished" && !isViewingHistory && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.72)",
                backdropFilter: "blur(6px)",
              }}
            >
              <div
                style={{
                  fontSize: 64,
                  lineHeight: 1,
                  color: "#e8e6e3",
                  fontWeight: 700,
                }}
              >
                {game.result === "1/2-1/2"
                  ? "½–½"
                  : game.result === "1-0"
                    ? "1–0"
                    : "0–1"}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: "#e8e6e3",
                  marginTop: 10,
                }}
              >
                {resultLabel}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#6b6b7a",
                  fontFamily: "JetBrains Mono, monospace",
                  marginTop: 6,
                }}
              >
                by {game.finishReason}
              </div>
            </div>
          )}

          {/* Draw offer popup */}
          {pendingDrawFromOpponent && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 28,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.78)",
                backdropFilter: "blur(4px)",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>🤝</div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#e8e6e3",
                  marginBottom: 6,
                }}
              >
                Draw offered
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#94a3b8",
                  fontFamily: "JetBrains Mono, monospace",
                  marginBottom: 20,
                }}
              >
                {game.drawOffer === "w" ? game.whiteName : game.blackName}{" "}
                offers a draw
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={acceptDraw}
                  style={{
                    padding: "10px 24px",
                    background: "#166534",
                    border: "1px solid #15803d",
                    borderRadius: 6,
                    color: "#86efac",
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Accept
                </button>
                <button
                  onClick={declineDraw}
                  style={{
                    padding: "10px 24px",
                    background: "#7f1d1d",
                    border: "1px solid #991b1b",
                    borderRadius: 6,
                    color: "#fca5a5",
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Promotion picker */}
          {promoData && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 28,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(4px)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#6b6b7a",
                  marginBottom: 14,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Promote to
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {(myColor === "w"
                  ? [
                      ["q", "♕"],
                      ["r", "♖"],
                      ["b", "♗"],
                      ["n", "♘"],
                    ]
                  : [
                      ["q", "♛"],
                      ["r", "♜"],
                      ["b", "♝"],
                      ["n", "♞"],
                    ]
                ).map(([p, sym]) => (
                  <button
                    key={p}
                    onClick={() => confirmPromotion(p)}
                    style={{
                      width: 72,
                      height: 72,
                      fontSize: 44,
                      lineHeight: 1,
                      background: "rgba(255,255,255,0.08)",
                      border: "2px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      cursor: "pointer",
                      color: "#e8e6e3",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(201,168,76,0.2)";
                      e.currentTarget.style.borderColor = "#c9a84c";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.08)";
                      e.currentTarget.style.borderColor =
                        "rgba(255,255,255,0.15)";
                    }}
                  >
                    {sym}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPromoData(null)}
                style={{
                  marginTop: 16,
                  fontSize: 12,
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#4a4a5a",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <Chessboard
            id="main-board"
            position={displayFen}
            onPieceDrop={onDrop}
            onSquareClick={onSquareClick}
            onPieceDragBegin={onDragStart}
            boardOrientation={boardOrientation}
            arePiecesDraggable={!!myColor && game.status === "active"}
            customSquareStyles={customSquareStyles}
            boardWidth={580}
            customDarkSquareStyle={{ backgroundColor: "#b58863" }}
            customLightSquareStyle={{ backgroundColor: "#f0d9b5" }}
            animationDuration={80}
            showBoardNotation={true}
          />
        </div>

        {/* Bottom player bar */}
        <PlayerBar
          player={bottomPlayer}
          isActive={bottomPlayer.active && !isViewingHistory}
        />

        {/* Action buttons */}
        <div
          style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}
        >
          {canAbort && (
            <button onClick={abortGame} style={btnStyle("ghost")}>
              Abort
            </button>
          )}
          {canResign && !resignConfirm && (
            <button
              onClick={() => setResignConfirm(true)}
              style={btnStyle(
                "ghost",
                "rgba(252,165,165,0.9)",
                "rgba(252,165,165,0.15)",
              )}
            >
              ⚑ Resign
            </button>
          )}
          {resignConfirm && (
            <>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#fca5a5",
                  alignSelf: "center",
                }}
              >
                Confirm?
              </span>
              <button onClick={resign} style={btnStyle("danger")}>
                Yes, Resign
              </button>
              <button
                onClick={() => setResignConfirm(false)}
                style={btnStyle("ghost")}
              >
                Cancel
              </button>
            </>
          )}
          {canOfferDraw && (
            <button onClick={offerDraw} style={btnStyle("ghost")}>
              ½ Offer Draw
            </button>
          )}
          {drawSent && (
            <span
              style={{
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
                color: "#94a3b8",
                alignSelf: "center",
              }}
            >
              Draw offered…
            </span>
          )}
          {isViewingHistory && (
            <button
              onClick={goToLive}
              style={{ ...btnStyle("primary"), marginLeft: "auto" }}
            >
              ▶ Live
            </button>
          )}
          {error && (
            <span
              style={{
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
                color: "#fca5a5",
                alignSelf: "center",
              }}
            >
              {error}
            </span>
          )}
        </div>
      </div>

      {/* ══ SIDEBAR ══ */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: 300,
          flexShrink: 0,
        }}
      >
        {/* Game header */}
        <div
          style={{
            background: "#111118",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e6e3" }}>
              {game.tournamentName}
            </div>
            <div
              style={{
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                color: "#6b6b7a",
                marginTop: 3,
              }}
            >
              Round {game.round} · {game.timeControl}
              {user.role === "admin" && " · Admin view"}
            </div>
          </div>
          <div
            style={{
              padding: "10px 16px",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                ...badgeStyle,
                ...(game.status === "active" ? badgeGreen : badgeSlate),
              }}
            >
              {game.status}
            </span>
            {game.result && (
              <span style={{ ...badgeStyle, ...badgeGold }}>{game.result}</span>
            )}
            <span style={{ ...badgeStyle, ...badgeSlate }}>
              {game.activeColor === "w" ? "White" : "Black"} to move
            </span>
          </div>
          {game.status === "finished" && (
            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                fontSize: 13,
                fontFamily: "JetBrains Mono, monospace",
                color: "#c9a84c",
              }}
            >
              {resultLabel} · {game.finishReason}
            </div>
          )}
          <div
            style={{
              padding: "8px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              fontSize: 11,
              fontFamily: "JetBrains Mono, monospace",
              color: "#4a4a5a",
            }}
          >
            {user.role === "admin"
              ? "👁 Spectating all games"
              : myColor === "w"
                ? "You play White"
                : myColor === "b"
                  ? "You play Black"
                  : "Observer"}
            {canPlay && " · YOUR TURN"}
          </div>
        </div>

        {/* Move list */}
        <div
          style={{
            background: "#111118",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                color: "#4a4a5a",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Moves {game.moves?.length ? `(${game.moves.length})` : ""}
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                color: "#3a3a4a",
              }}
            >
              ← → to navigate
            </span>
          </div>
          <MoveHistory
            moves={game.moves || []}
            currentIndex={moveIndex}
            onSelect={goToMove}
          />
          <div
            style={{
              padding: "6px 8px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              gap: 3,
            }}
          >
            {[
              ["⏮", () => goToMove(0)],
              ["◀", () => goToMove(moveIndex - 1)],
              ["▶", () => goToMove(moveIndex + 1)],
              ["⏭", goToLive],
            ].map(([label, fn]) => (
              <button
                key={label}
                onClick={fn}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 5,
                  color: "#4a4a5a",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#c9a84c";
                  e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#4a4a5a";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* FEN display (live) */}
        {!isViewingHistory && game.status === "active" && (
          <div
            style={{
              background: "#111118",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                color: "#3a3a4a",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              FEN
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                color: "#5a5a6a",
                wordBreak: "break-all",
                lineHeight: 1.5,
              }}
            >
              {game.fen === "start"
                ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                : game.fen}
            </div>
          </div>
        )}

        {/* PGN */}
        {game.status === "finished" && game.pgn && (
          <div
            style={{
              background: "#111118",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                color: "#4a4a5a",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              PGN
            </div>
            <div style={{ padding: "12px 14px" }}>
              <pre
                style={{
                  fontSize: 10,
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#6b6b7a",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  lineHeight: 1.6,
                  maxHeight: 160,
                  overflowY: "auto",
                  margin: 0,
                }}
              >
                {game.pgn}
              </pre>
              <button
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(game.pgn)
                    .then(() => notify("success", "PGN copied!"))
                }
                style={{
                  ...btnStyle("ghost"),
                  fontSize: 11,
                  padding: "5px 12px",
                  marginTop: 10,
                }}
              >
                Copy PGN
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Player bar component ──
function PlayerBar({ player, isActive }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: isActive ? "rgba(201,168,76,0.06)" : "#0d0d14",
        border: `1px solid ${isActive ? "rgba(201,168,76,0.35)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 8,
        transition: "all 0.3s",
        width: 580,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13 }}>
            {player.color === "w" ? "⬜" : "⬛"}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#e8e6e3" }}>
            {player.name}
          </span>
          {isActive && (
            <span
              style={{
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                color: "#c9a84c",
                letterSpacing: "0.08em",
              }}
            >
              TO MOVE
            </span>
          )}
        </div>
        <CapturedPieces pieces={player.captured} advantage={player.material} />
      </div>
      <Clock ms={player.ms} active={isActive} />
    </div>
  );
}

// ── Style helpers ──
const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 3,
  fontSize: 10,
  fontFamily: "JetBrains Mono, monospace",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  border: "1px solid",
};
const badgeGold = {
  background: "rgba(201,168,76,0.12)",
  color: "#c9a84c",
  borderColor: "rgba(201,168,76,0.3)",
};
const badgeGreen = {
  background: "rgba(134,239,172,0.08)",
  color: "#86efac",
  borderColor: "rgba(134,239,172,0.25)",
};
const badgeSlate = {
  background: "rgba(148,163,184,0.06)",
  color: "#64748b",
  borderColor: "rgba(148,163,184,0.15)",
};

function btnStyle(variant, color, bg) {
  const base = {
    padding: "8px 16px",
    borderRadius: 6,
    fontFamily: "JetBrains Mono, monospace",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.05em",
    cursor: "pointer",
    border: "1px solid",
    transition: "all 0.15s",
  };
  if (variant === "primary")
    return {
      ...base,
      background: "#c9a84c",
      color: "#0a0a0f",
      borderColor: "#c9a84c",
    };
  if (variant === "danger")
    return {
      ...base,
      background: "#7f1d1d",
      color: "#fca5a5",
      borderColor: "#991b1b",
    };
  return {
    ...base,
    background: bg || "transparent",
    color: color || "#94a3b8",
    borderColor: "rgba(255,255,255,0.1)",
  };
}

// ─── ROOT ────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    async function boot() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const data = await api("/api/me");
        setUser(data.user);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        setBooting(false);
      }
    }
    boot();
  }, []);

  if (booting)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0a0f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4a4a5a",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );

  return <Layout user={user} setUser={setUser} />;
}
