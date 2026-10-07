"use client";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { LANGS, suggestLang } from "./langs";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const TOOL_LABELS = { get_services: "services", get_availability: "slots", book_appointment: "booking" }; // -> t keys

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

async function authFetch(path, init = {}) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${data.session?.access_token}` },
  });
  if (res.status === 401) await supabase.auth.signOut(); // expired session -> back to login
  if (!res.ok) throw new Error(res.statusText);
  return res;
}

function ThemeToggle() {
  const [theme, setTheme] = useState(null); // null = follow system
  useEffect(() => setTheme(store.get("theme")), []);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);
  const dark = () => (theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      className="icon"
      aria-label="Toggle dark mode"
      onClick={() => {
        const next = dark() ? "light" : "dark";
        store.set("theme", next);
        setTheme(next);
      }}
    >
      ◐
    </button>
  );
}

function LangChip({ lang, onClick }) {
  return (
    <button
      type="button"
      className="chip"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${LANGS[lang].t.lang}: ${LANGS[lang].en}`}
    >
      🌐 {LANGS[lang].name}
    </button>
  );
}

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [lang, setLang] = useState(undefined); // undefined = loading, null = not chosen yet
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const saved = store.get("lang");
    setLang(LANGS[saved] ? saved : null);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!lang) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGS[lang].rtl ? "rtl" : "ltr";
  }, [lang]);

  if (session === undefined || lang === undefined) return null;
  const showPicker = !lang || picking;
  const openPicker = () => setPicking(true);
  return (
    <>
      {lang && (
        // inert while the picker covers it, so the chat (and its history) survives a language change
        <div inert={showPicker || undefined}>
          {session ? (
            <Chat user={session.user} lang={lang} onLang={openPicker} />
          ) : (
            <Auth lang={lang} onLang={openPicker} />
          )}
        </div>
      )}
      {showPicker && (
        <LanguagePicker
          current={lang}
          onPick={(code) => {
            store.set("lang", code);
            setLang(code);
            setPicking(false);
          }}
          onClose={lang ? () => setPicking(false) : null}
        />
      )}
    </>
  );
}

function LanguagePicker({ current, onPick, onClose }) {
  const suggested = current || suggestLang();
  const order = [suggested, ...Object.keys(LANGS).filter((c) => c !== suggested)];
  return (
    <main className="picker">
      <div className="picker-head">
        <div>
          <h1>Choose your language</h1>
          <p lang="hi">अपनी भाषा चुनें</p>
        </div>
        {onClose ? (
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        ) : (
          <ThemeToggle />
        )}
      </div>
      <div className="lang-grid">
        {order.map((code) => (
          <button
            type="button"
            key={code}
            lang={code}
            className={`lang-tile${code === suggested ? " suggested" : ""}`}
            aria-current={code === current || undefined}
            onClick={() => onPick(code)}
          >
            <span className="native" dir="auto">
              {LANGS[code].name}
            </span>
            <span className="latin">{LANGS[code].en}</span>
            {code === suggested && <span className="badge">{current ? "✓ Current" : "Suggested"}</span>}
          </button>
        ))}
      </div>
      <p className="hint">You can change this anytime with 🌐 at the top.</p>
    </main>
  );
}

function Auth({ lang, onLang }) {
  const t = LANGS[lang].t;
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [msg, setMsg] = useState(null); // {error|info: text}
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const email = form.email.trim();
    const { data, error } = signup
      ? await supabase.auth.signUp({ email, password: form.password, options: { data: { name: form.name.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password: form.password });
    setBusy(false);
    if (error) setMsg({ error: error.message });
    else if (signup && !data.session) setMsg({ info: t.inbox });
  }

  return (
    <main className="auth">
      <div className="auth-head">
        <h1>Salon</h1>
        <LangChip lang={lang} onClick={onLang} />
        <ThemeToggle />
      </div>
      <div className="tabs" role="tablist">
        {["login", "signup"].map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setMsg(null);
            }}
          >
            {t[m]}
          </button>
        ))}
      </div>
      <form onSubmit={submit}>
        {signup && (
          <label>
            {t.name}
            <input value={form.name} onChange={set("name")} autoComplete="name" required />
          </label>
        )}
        <label>
          {t.email}
          <input type="email" dir="ltr" value={form.email} onChange={set("email")} autoComplete="email" required />
        </label>
        <label>
          {t.password}
          <input
            type="password"
            dir="ltr"
            value={form.password}
            onChange={set("password")}
            minLength={6}
            required
            autoComplete={signup ? "new-password" : "current-password"}
          />
          {signup && <small>{t.pwHint}</small>}
        </label>
        {msg && (
          <p role="alert" className={msg.error ? "error" : "info"}>
            {msg.error ? "⚠ " : ""}
            {msg.error || msg.info}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t.wait : signup ? t.create : t.login}
        </button>
      </form>
    </main>
  );
}

function Chat({ user, lang, onLang }) {
  const name = user.user_metadata?.name;
  const L = LANGS[lang];
  const t = L.t;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(null); // null = idle, otherwise indicator text
  const [recorder, setRecorder] = useState(null);
  const msgsRef = useRef([]); // latest history; state can lag behind a just-pushed message
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever new content appears
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  function push(m) {
    msgsRef.current = [...msgsRef.current, { ...m, id: crypto.randomUUID() }];
    setMessages(msgsRef.current);
  }

  async function send(text) {
    text = text.trim();
    if (!text) return;
    push({ role: "user", content: text });
    setInput("");
    setStatus(t.thinking);
    try {
      const history = msgsRef.current
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(({ role, content }) => ({ role, content }));
      const res = await authFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, lang }),
      });
      // Backend streams NDJSON: "tool" / "booked" events, then one "reply"
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const ev = JSON.parse(line);
          if (ev.type === "tool") setStatus(t[TOOL_LABELS[ev.name]] || t.thinking);
          else if (ev.type === "booked") push({ role: "booked", booking: ev.booking });
          else push({ role: "assistant", content: ev.content });
        }
      }
    } catch {
      push({ role: "note", content: t.offline });
    } finally {
      setStatus(null);
    }
  }

  // Tap to record, tap again to stop; the transcript lands in the input so names/times can be checked before sending.
  async function toggleMic() {
    if (recorder) return recorder.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return push({ role: "note", content: t.noMic });
    }
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      setRecorder(null);
      setStatus(t.transcribing);
      try {
        const body = new FormData();
        body.append("audio", new Blob(chunks, { type: rec.mimeType }), "voice.webm");
        body.append("lang", lang);
        setInput((await (await authFetch("/transcribe", { method: "POST", body })).json()).text);
        inputRef.current?.focus();
      } catch {
        push({ role: "note", content: t.retry });
      } finally {
        setStatus(null);
      }
    };
    rec.start();
    setRecorder(rec);
  }

  const busy = !!status;
  const hello = L.hello.replace("{n}", name ? ` ${name}` : "");

  return (
    <main className="chat">
      <header>
        <span className="title">Salon</span>
        <LangChip lang={lang} onClick={recorder ? undefined : onLang} />
        <ThemeToggle />
        <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
          {t.logout}
        </button>
      </header>
      <div className="log" aria-live="polite">
        <div dir="auto" className="bubble assistant">
          {hello}
        </div>
        {messages.map((m) =>
          m.role === "booked" ? (
            <BookingCard key={m.id} booking={m.booking} lang={lang} />
          ) : (
            <div key={m.id} dir="auto" className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ),
        )}
        {messages.length === 0 && !status && (
          <div className="starters">
            {L.starters.map((s) => (
              <button type="button" key={s} dir="auto" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {status && (
          <div className="bubble assistant status">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>{" "}
            {status}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) send(input);
        }}
      >
        <button
          type="button"
          className={`mic${recorder ? " on" : ""}`}
          onClick={toggleMic}
          disabled={busy}
          aria-pressed={!!recorder}
          aria-label={recorder ? "Stop recording" : "Record voice message"}
        >
          {recorder ? "■" : "🎙"}
        </button>
        <input
          ref={inputRef}
          dir="auto"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={recorder ? t.listening : t.type}
          aria-label={t.type}
          disabled={!!recorder}
        />
        <button type="submit" className="primary" disabled={!input.trim() || busy || !!recorder}>
          {t.send}
        </button>
      </form>
    </main>
  );
}

// The end of the booking journey gets its own clear, calm moment (peak-end rule).
function BookingCard({ booking, lang }) {
  const day = new Date(`${booking.date}T00:00`).toLocaleDateString(`${lang}-IN`, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <div className="booked" role="status">
      <div className="booked-head">✓ {LANGS[lang].t.booked}</div>
      <div className="booked-main">
        {booking.service} · {booking.stylist}
      </div>
      <div className="booked-meta">
        {day} · {booking.time} · ${booking.price}
      </div>
    </div>
  );
}
