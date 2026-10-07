"use client";
import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOOL_LABELS = {
  get_services: "Checking the service menu…",
  get_availability: "Checking stylist availability…",
  book_appointment: "Booking your appointment…",
};

export default function Chat() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I can show our services, check availability, and book you in. How can I help?" },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(null); // null = idle, otherwise indicator text
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || status) return;
    const history = [...messages, { role: "user", content: text }];
    setMessages(history);
    setInput("");
    setStatus("Thinking…");
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) throw new Error(res.statusText);
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

  return (
    <main className="chat">
      <header>✂️ Salon Booking Assistant</header>
      <div className="log" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>{m.content}</div>
        ))}
        {status && (
          <div className="bubble assistant status">
            <span className="dots"><i /><i /><i /></span> {status}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Try "Book a haircut with Alex at 10:00 AM under John"'
          aria-label="Message"
          autoFocus
        />
        <button disabled={!input.trim() || !!status}>Send</button>
      </form>
    </main>
  );
}
