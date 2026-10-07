"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const TOOL_LABELS = {
  get_services: "Checking the service menu…",
  get_availability: "Checking stylist availability…",
  book_appointment: "Booking your appointment…",
};
const STARTERS = ["What services do you offer?", "Who's free tomorrow for a haircut?", "¿Hay citas para un facial?"];

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

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return null;
  return session ? <Chat user={session.user} /> : <Auth />;
}

function Auth() {
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
    else if (signup && !data.session) setMsg({ info: "Check your inbox to confirm your email, then log in." });
  }

  return (
    <main className="auth">
      <h1>✂️ Salon Booking</h1>
      <div className="tabs" role="tablist">
        {["login", "signup"].map((m) => (
          <button key={m} role="tab" type="button" aria-selected={mode === m}
            onClick={() => { setMode(m); setMsg(null); }}>
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>
      <form onSubmit={submit}>
        {signup && (
          <label>Your name
            <input value={form.name} onChange={set("name")} autoComplete="name" required />
          </label>
        )}
        <label>Email
          <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
        </label>
        <label>Password
          <input type="password" value={form.password} onChange={set("password")} minLength={6} required
            autoComplete={signup ? "new-password" : "current-password"} />
          {signup && <small>At least 6 characters</small>}
        </label>
        {msg && <p role="alert" className={msg.error ? "error" : "info"}>{msg.error ? "⚠ " : ""}{msg.error || msg.info}</p>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Log in"}</button>
      </form>
    </main>
  );
}

function Chat({ user }) {
  const name = user.user_metadata?.name;
  const [messages, setMessages] = useState([
    { role: "assistant", content: `Hi${name ? ` ${name}` : ""}! I can show our services, check availability, and book you in. Type or tap 🎤 and speak in any language.` },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(null); // null = idle, otherwise indicator text
  const [recorder, setRecorder] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function send(text) {
    text = text.trim();
    if (!text || status) return;
    const history = [...messages, { role: "user", content: text }];
    setMessages(history);
    setInput("");
    setStatus("Thinking…");
    try {
      const res = await authFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      // Backend streams NDJSON: {"type":"tool",...} events, then one {"type":"reply",...}
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
          if (ev.type === "tool") setStatus(TOOL_LABELS[ev.name] || `Running ${ev.name}…`);
          else setMessages((m) => [...m, { role: "assistant", content: ev.content }]);
        }
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the salon server. Is the backend running?" }]);
    } finally {
      setStatus(null);
    }
  }

  async function toggleMic() {
    if (recorder) return recorder.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setMessages((m) => [...m, { role: "assistant", content: "I can't access your microphone. Please allow it in your browser, or type instead." }]);
    }
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecorder(null);
      setStatus("Transcribing…");
      try {
        const body = new FormData();
        body.append("audio", new Blob(chunks, { type: rec.mimeType }), "voice.webm");
        const { text } = await (await authFetch("/transcribe", { method: "POST", body })).json();
        setInput(text); // let the user check names/times before sending
        inputRef.current?.focus();
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't hear that. Please try again or type." }]);
      } finally {
        setStatus(null);
      }
    };
    rec.start();
    setRecorder(rec);
  }

  return (
    <main className="chat">
      <header>
        <span>✂️ Salon Booking Assistant</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Log out</button>
      </header>
      <div className="log" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} dir="auto" className={`bubble ${m.role}`}>{m.content}</div>
        ))}
        {messages.length === 1 && !status && (
          <div className="starters">
            {STARTERS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {status && (
          <div className="bubble assistant status">
            <span className="dots"><i /><i /><i /></span> {status}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <button type="button" className={`mic${recorder ? " on" : ""}`} onClick={toggleMic}
          disabled={!!status} aria-pressed={!!recorder} aria-label={recorder ? "Stop recording" : "Record voice message"}>
          {recorder ? "■" : "🎤"}
        </button>
        <input
          ref={inputRef}
          dir="auto"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={recorder ? "Listening… tap ■ when done" : "Message in any language…"}
          aria-label="Message"
          autoFocus
        />
        <button className="primary" disabled={!input.trim() || !!status || !!recorder}>Send</button>
      </form>
    </main>
  );
}
