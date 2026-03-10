import { useEffect, useMemo, useState } from "react";
import {
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Chessboard } from "react-chessboard";

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

const TOKEN_KEY = "playchess_token";

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function formatDate(v) {
  if (!v) return "-";
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

  if (game.status === "active") {
    const activeColor = game.activeColor;
    if (activeColor === color && game.lastMoveAt) {
      const elapsed = Date.now() - new Date(game.lastMoveAt).getTime();
      ms -= elapsed;
    }
  }

  return Math.max(0, ms);
}

function StatusBadge({ children, color = "slate" }) {
  const map = {
    slate: "bg-slate-500/10 border-slate-400/20 text-slate-200",
    green: "bg-emerald-500/10 border-emerald-400/20 text-emerald-300",
    red: "bg-rose-500/10 border-rose-400/20 text-rose-300",
    blue: "bg-sky-500/10 border-sky-400/20 text-sky-300",
    yellow: "bg-amber-500/10 border-amber-400/20 text-amber-300",
    violet: "bg-violet-500/10 border-violet-400/20 text-violet-300",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${map[color]}`}
    >
      {children}
    </span>
  );
}

function Layout({ user, setUser }) {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_24%),linear-gradient(to_bottom,#020617,#0f172a)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <Link
                to="/"
                className="text-3xl font-black tracking-tight text-white"
              >
                PlayChess
              </Link>
              <p className="mt-2 text-sm text-slate-300">
                Real student tournament platform with admin-only monitoring.
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-3">
              <Link
                to="/"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
              >
                Tournaments
              </Link>

              {user ? (
                <>
                  <Link
                    to="/dashboard"
                    className="rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-500/20"
                  >
                    Dashboard
                  </Link>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200">
                    {user.name} • {user.role}
                  </div>

                  <button
                    onClick={logout}
                    className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-400"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                  >
                    Login
                  </Link>
                  <Link
                    to="/register"
                    className="rounded-2xl bg-violet-500 px-4 py-2 text-sm font-bold text-white hover:bg-violet-400"
                  >
                    Register
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>

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
            element={user ? <GamePage user={user} /> : <Navigate to="/login" />}
          />
        </Routes>
      </div>
    </div>
  );
}

function Card({ title, subtitle, right, children }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl shadow-black/20 backdrop-blur">
      <div className="flex flex-col gap-3 border-b border-white/10 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          ) : null}
        </div>
        {right}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-violet-400"
      />
    </label>
  );
}

function Textarea({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">
        {label}
      </span>
      <textarea
        {...props}
        className="min-h-[110px] w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-violet-400"
      />
    </label>
  );
}

function Select({ label, children, ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">
        {label}
      </span>
      <select
        {...props}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-violet-400"
      >
        {children}
      </select>
    </label>
  );
}

function PublicHome({ user }) {
  const [tournaments, setTournaments] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await api("/api/tournaments");
      setTournaments(data.tournaments || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-8">
      <Card
        title="Student Tournaments"
        subtitle="Not logged in: only tournament pages are visible. Students must log in to join and play."
      >
        {error ? <p className="text-rose-300">{error}</p> : null}

        {!tournaments.length ? (
          <p className="text-slate-400">No tournaments yet.</p>
        ) : (
          <div className="grid gap-4">
            {tournaments.map((t) => (
              <Link
                key={t.id}
                to={`/tournaments/${t.id}`}
                className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 transition hover:border-violet-400/30 hover:bg-slate-900/60"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge
                    color={
                      t.status === "registration"
                        ? "green"
                        : t.status === "ongoing"
                          ? "blue"
                          : "slate"
                    }
                  >
                    {t.status}
                  </StatusBadge>
                  <StatusBadge color="violet">
                    {t.minutes}+{t.increment}
                  </StatusBadge>
                  <StatusBadge color="yellow">{t.rounds} rounds</StatusBadge>
                  <StatusBadge>{t.format}</StatusBadge>
                </div>

                <h3 className="text-2xl font-black">{t.name}</h3>
                <p className="mt-2 text-slate-300">{t.description}</p>

                <div className="mt-4 grid gap-2 text-sm text-slate-400 sm:grid-cols-2">
                  <p>Location: {t.location}</p>
                  <p>
                    Players: {t.playerCount}/{t.maxPlayers}
                  </p>
                  <p>Starts: {formatDate(t.startAt)}</p>
                  <p>
                    Round: {t.currentRound}/{t.rounds}
                  </p>
                </div>

                {!user ? (
                  <p className="mt-4 text-sm text-violet-300">
                    Login required to join and play.
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TournamentDetails({ user }) {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await api(`/api/tournaments/${id}`);
      setTournament(data.tournament);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function joinTournament() {
    try {
      setError("");
      setMessage("");
      await api(`/api/tournaments/${id}/join`, { method: "POST" });
      setMessage("You joined this tournament.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!tournament) {
    return <p className="text-slate-300">{error || "Loading..."}</p>;
  }

  return (
    <div className="space-y-8">
      <Card
        title={tournament.name}
        subtitle="Tournament details"
        right={
          tournament.status === "registration" && user?.role === "student" ? (
            <button
              onClick={joinTournament}
              className="rounded-2xl bg-violet-500 px-4 py-2 font-bold text-white hover:bg-violet-400"
            >
              Join Tournament
            </button>
          ) : null
        }
      >
        {message ? (
          <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-300">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap gap-2">
          <StatusBadge color="violet">
            {tournament.minutes}+{tournament.increment}
          </StatusBadge>
          <StatusBadge color="yellow">{tournament.rounds} rounds</StatusBadge>
          <StatusBadge>{tournament.format}</StatusBadge>
          <StatusBadge
            color={
              tournament.status === "registration"
                ? "green"
                : tournament.status === "ongoing"
                  ? "blue"
                  : "slate"
            }
          >
            {tournament.status}
          </StatusBadge>
        </div>

        <p className="text-slate-300">{tournament.description}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-sm text-slate-400">Location</p>
            <p className="mt-1 font-bold">{tournament.location}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-sm text-slate-400">Start</p>
            <p className="mt-1 font-bold">{formatDate(tournament.startAt)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-sm text-slate-400">Players</p>
            <p className="mt-1 font-bold">
              {tournament.players?.length || 0}/{tournament.maxPlayers}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-sm text-slate-400">Current Round</p>
            <p className="mt-1 font-bold">
              {tournament.currentRound}/{tournament.rounds}
            </p>
          </div>
        </div>

        {tournament.standings?.length ? (
          <div className="mt-6">
            <h3 className="mb-3 text-lg font-bold">Standings</h3>
            <div className="space-y-2">
              {tournament.standings.map((s, i) => (
                <div
                  key={s.userId}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3"
                >
                  <div className="font-semibold">
                    {i + 1}. {s.name}
                  </div>
                  <div className="text-slate-300">{s.score} pts</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function LoginPage({ setUser }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      setError("");
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Card
      title="Login"
      subtitle="Students play games after login. Admin watches every board."
    >
      <form onSubmit={submit} className="mx-auto max-w-xl space-y-4">
        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300">
            {error}
          </div>
        ) : null}
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
          required
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
          required
        />
        <button className="rounded-2xl bg-violet-500 px-5 py-3 font-bold text-white hover:bg-violet-400">
          Login
        </button>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          Default admin: <strong>admin@playchess.com</strong> /{" "}
          <strong>admin123</strong>
        </div>
      </form>
    </Card>
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

  async function submit(e) {
    e.preventDefault();
    try {
      setError("");
      const data = await api("/api/register", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Card
      title="Student Registration"
      subtitle="Creates a student account for joining tournaments and playing games."
    >
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300">
            {error}
          </div>
        ) : null}
        <Input
          label="Full Name"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            required
          />
          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) =>
              setForm((p) => ({ ...p, password: e.target.value }))
            }
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="School"
            value={form.school}
            onChange={(e) => setForm((p) => ({ ...p, school: e.target.value }))}
          />
          <Input
            label="Grade"
            value={form.grade}
            onChange={(e) => setForm((p) => ({ ...p, grade: e.target.value }))}
          />
        </div>
        <button className="rounded-2xl bg-violet-500 px-5 py-3 font-bold text-white hover:bg-violet-400">
          Create Account
        </button>
      </form>
    </Card>
  );
}

function StudentDashboard({ user }) {
  const [myGames, setMyGames] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      setError("");
      const [gamesData, tournamentData] = await Promise.all([
        api("/api/my-games"),
        api("/api/tournaments"),
      ]);
      setMyGames(gamesData.games || []);
      setTournaments(tournamentData.tournaments || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const joinedIds = useMemo(() => {
    return new Set(
      tournaments
        .filter((t) => t.players?.some((p) => p.userId === user.id))
        .map((t) => t.id),
    );
  }, [tournaments, user.id]);

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300">
          {error}
        </div>
      ) : null}

      <Card
        title="My Games"
        subtitle="You can only open your own assigned games."
      >
        {!myGames.length ? (
          <p className="text-slate-400">No assigned games yet.</p>
        ) : (
          <div className="grid gap-4">
            {myGames.map((g) => (
              <Link
                key={g.id}
                to={`/game/${g.id}`}
                className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 hover:border-violet-400/30 hover:bg-slate-900/60"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge
                    color={g.status === "active" ? "green" : "slate"}
                  >
                    {g.status}
                  </StatusBadge>
                  <StatusBadge color="violet">Round {g.round}</StatusBadge>
                </div>
                <h3 className="text-xl font-black">
                  {g.whiteName} vs {g.blackName}
                </h3>
                <p className="mt-2 text-slate-300">{g.tournamentName}</p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card title="My Tournaments" subtitle="Tournaments you already joined.">
        <div className="grid gap-4">
          {tournaments
            .filter((t) => joinedIds.has(t.id))
            .map((t) => (
              <div
                key={t.id}
                className="rounded-3xl border border-white/10 bg-slate-950/40 p-5"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge
                    color={
                      t.status === "registration"
                        ? "green"
                        : t.status === "ongoing"
                          ? "blue"
                          : "slate"
                    }
                  >
                    {t.status}
                  </StatusBadge>
                  <StatusBadge color="violet">
                    {t.minutes}+{t.increment}
                  </StatusBadge>
                </div>
                <h3 className="text-xl font-black">{t.name}</h3>
                <p className="mt-2 text-slate-300">
                  Round {t.currentRound}/{t.rounds}
                </p>
              </div>
            ))}

          {!tournaments.some((t) => joinedIds.has(t.id)) ? (
            <p className="text-slate-400">
              You have not joined any tournament yet.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function AdminDashboard() {
  const [tournaments, setTournaments] = useState([]);
  const [games, setGames] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  async function load() {
    try {
      setError("");
      const [tData, gData] = await Promise.all([
        api("/api/tournaments"),
        api("/api/admin/games"),
      ]);
      setTournaments(tData.tournaments || []);
      setGames(gData.games || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  async function createTournament(e) {
    e.preventDefault();
    try {
      setError("");
      setMessage("");
      await api("/api/tournaments", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          rounds: Number(form.rounds),
          minutes: Number(form.minutes),
          increment: Number(form.increment),
          maxPlayers: Number(form.maxPlayers),
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

  return (
    <div className="space-y-8">
      {message ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-300">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300">
          {error}
        </div>
      ) : null}

      <Card
        title="Create Tournament"
        subtitle="Admin controls rounds, time control, increment and tournament format."
      >
        <form onSubmit={createTournament} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Tournament Name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </div>
          <div className="md:col-span-2">
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
            />
          </div>
          <Input
            label="Location"
            value={form.location}
            onChange={(e) =>
              setForm((p) => ({ ...p, location: e.target.value }))
            }
            required
          />
          <Select
            label="Format"
            value={form.format}
            onChange={(e) => setForm((p) => ({ ...p, format: e.target.value }))}
          >
            <option value="swiss">Swiss</option>
            <option value="round-robin">Round Robin</option>
          </Select>
          <Input
            label="Rounds"
            type="number"
            min="1"
            value={form.rounds}
            onChange={(e) => setForm((p) => ({ ...p, rounds: e.target.value }))}
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
            label="Increment (seconds)"
            type="number"
            min="0"
            value={form.increment}
            onChange={(e) =>
              setForm((p) => ({ ...p, increment: e.target.value }))
            }
            required
          />
          <div className="md:col-span-2">
            <Input
              label="Start Date & Time"
              type="datetime-local"
              value={form.startAt}
              onChange={(e) =>
                setForm((p) => ({ ...p, startAt: e.target.value }))
              }
              required
            />
          </div>

          <div className="md:col-span-2 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-4">
            <div>
              <p className="text-sm text-slate-400">Preview</p>
              <p className="text-2xl font-black text-violet-300">
                {form.minutes}+{form.increment}
              </p>
            </div>
            <button className="rounded-2xl bg-violet-500 px-5 py-3 font-bold text-white hover:bg-violet-400">
              Create Tournament
            </button>
          </div>
        </form>
      </Card>

      <Card
        title="Manage Tournaments"
        subtitle="Start rounds and create live games."
      >
        {!tournaments.length ? (
          <p className="text-slate-400">No tournaments yet.</p>
        ) : (
          <div className="grid gap-4">
            {tournaments.map((t) => (
              <div
                key={t.id}
                className="rounded-3xl border border-white/10 bg-slate-950/40 p-5"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge
                    color={
                      t.status === "registration"
                        ? "green"
                        : t.status === "ongoing"
                          ? "blue"
                          : "slate"
                    }
                  >
                    {t.status}
                  </StatusBadge>
                  <StatusBadge color="violet">
                    {t.minutes}+{t.increment}
                  </StatusBadge>
                  <StatusBadge color="yellow">
                    Round {t.currentRound}/{t.rounds}
                  </StatusBadge>
                  <StatusBadge>{t.format}</StatusBadge>
                </div>

                <h3 className="text-xl font-black">{t.name}</h3>
                <p className="mt-2 text-slate-300">{t.description}</p>

                <div className="mt-4 grid gap-2 text-sm text-slate-400 sm:grid-cols-2">
                  <p>
                    Players: {t.playerCount}/{t.maxPlayers}
                  </p>
                  <p>Start: {formatDate(t.startAt)}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => startRound(t.id)}
                    className="rounded-2xl bg-emerald-500 px-4 py-2 font-bold text-white hover:bg-emerald-400"
                  >
                    {t.currentRound === 0
                      ? "Start Round 1"
                      : "Start Next Round"}
                  </button>
                  <Link
                    to={`/tournaments/${t.id}`}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 font-semibold text-slate-200 hover:bg-white/10"
                  >
                    View Tournament
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Live Games Monitor"
        subtitle="Only admin can watch every live game."
      >
        {!games.length ? (
          <p className="text-slate-400">No games yet.</p>
        ) : (
          <div className="grid gap-4">
            {games.map((g) => (
              <Link
                key={g.id}
                to={`/game/${g.id}`}
                className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 hover:border-violet-400/30 hover:bg-slate-900/60"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge
                    color={g.status === "active" ? "green" : "slate"}
                  >
                    {g.status}
                  </StatusBadge>
                  <StatusBadge color="violet">Round {g.round}</StatusBadge>
                </div>
                <h3 className="text-xl font-black">
                  {g.whiteName} vs {g.blackName}
                </h3>
                <p className="mt-2 text-slate-300">{g.tournamentName}</p>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function GamePage({ user }) {
  const { id } = useParams();
  const [game, setGame] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const data = await api(`/api/games/${id}`);
      setGame(data.game);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [id]);

  async function onDrop(sourceSquare, targetSquare) {
    if (!game || user.role === "admin" || game.status !== "active")
      return false;

    try {
      setError("");
      setMessage("");
      const data = await api(`/api/games/${id}/move`, {
        method: "POST",
        body: JSON.stringify({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q",
        }),
      });
      setGame(data.game);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function resign() {
    try {
      const data = await api(`/api/games/${id}/resign`, { method: "POST" });
      setGame(data.game);
      setMessage("You resigned.");
    } catch (err) {
      setError(err.message);
    }
  }

  if (!game) {
    return <p className="text-slate-300">{error || "Loading game..."}</p>;
  }

  const myColor =
    user.role === "student"
      ? game.whiteId === user.id
        ? "w"
        : game.blackId === user.id
          ? "b"
          : null
      : null;

  const canPlay =
    user.role === "student" &&
    game.status === "active" &&
    ((game.activeColor === "w" && game.whiteId === user.id) ||
      (game.activeColor === "b" && game.blackId === user.id));

  const whiteClock = getLiveClock(game, "w");
  const blackClock = getLiveClock(game, "b");

  return (
    <div className="space-y-8">
      {message ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-300">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300">
          {error}
        </div>
      ) : null}

      <Card
        title={`${game.whiteName} vs ${game.blackName}`}
        subtitle={`${game.tournamentName} • Round ${game.round}`}
        right={
          <div className="flex flex-wrap gap-2">
            <StatusBadge color={game.status === "active" ? "green" : "slate"}>
              {game.status}
            </StatusBadge>
            <StatusBadge color="violet">{game.timeControl}</StatusBadge>
          </div>
        }
      >
        <div className="grid gap-8 xl:grid-cols-[420px_1fr]">
          <div>
            <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Black</p>
                  <p className="font-bold">{game.blackName}</p>
                </div>
                <div
                  className={`text-2xl font-black ${game.activeColor === "b" && game.status === "active" ? "text-amber-300" : "text-white"}`}
                >
                  {formatMs(blackClock)}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 p-3">
              <Chessboard
                id="playchess-board"
                position={game.fen}
                onPieceDrop={onDrop}
                boardOrientation={myColor === "b" ? "black" : "white"}
                arePiecesDraggable={canPlay}
              />
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">White</p>
                  <p className="font-bold">{game.whiteName}</p>
                </div>
                <div
                  className={`text-2xl font-black ${game.activeColor === "w" && game.status === "active" ? "text-amber-300" : "text-white"}`}
                >
                  {formatMs(whiteClock)}
                </div>
              </div>
            </div>

            {user.role === "student" ? (
              <div className="mt-4 flex gap-3">
                <button
                  onClick={resign}
                  disabled={!canPlay}
                  className="rounded-2xl bg-rose-500 px-4 py-3 font-bold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Resign
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
              <h3 className="mb-3 text-lg font-bold">Game Info</h3>
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
                  <p className="text-slate-400">Turn</p>
                  <p className="mt-1 font-bold">
                    {game.activeColor === "w" ? "White" : "Black"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
                  <p className="text-slate-400">Result</p>
                  <p className="mt-1 font-bold">{game.result || "-"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
                  <p className="text-slate-400">Your role</p>
                  <p className="mt-1 font-bold">
                    {user.role === "admin"
                      ? "Admin spectator"
                      : myColor === "w"
                        ? "White"
                        : myColor === "b"
                          ? "Black"
                          : "Not a player"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
                  <p className="text-slate-400">Can move</p>
                  <p className="mt-1 font-bold">{canPlay ? "Yes" : "No"}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
              <h3 className="mb-3 text-lg font-bold">Moves</h3>
              {!game.moves?.length ? (
                <p className="text-slate-400">No moves yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {game.moves.map((m, i) => (
                    <div
                      key={`${m.san}-${i}`}
                      className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2"
                    >
                      {i + 1}. {m.san}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {game.status === "finished" && game.pgn ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                <h3 className="mb-3 text-lg font-bold">PGN</h3>
                <pre className="whitespace-pre-wrap text-sm text-slate-300">
                  {game.pgn}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

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

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-white">
        Loading...
      </div>
    );
  }

  return <Layout user={user} setUser={setUser} />;
}
