import json
from datetime import date, timedelta
from pathlib import Path

from dotenv import dotenv_values
from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import Groq
from supabase import create_client
from pydantic import BaseModel

MODEL = "qwen/qwen3.8-27b"
STT_MODEL = "whisper-large-v3"  # full v3 (not turbo): better on non-English speech
TOMORROW = (date.today() + timedelta(days=1)).isoformat()

# ---------- Supabase ----------
ENV = dotenv_values(Path(__file__).parent.parent / ".env")
db = create_client(ENV["SUPABASE_URL"], ENV["SUPABASE_SECRET_KEY"])
# ponytail: any stylist does any service and a slot is a single start time (duration not blocked out);
# add per-stylist skills / overlap checks if the salon needs them.


def _norm(s: str) -> str:
    return s.lower().replace(" ", "").replace(":00", "")


def _services():
    return db.table("services").select("name, price, duration_mins").order("id").execute().data


def _find_service(name: str):
    return next((s for s in _services() if _norm(s["name"]) == _norm(name or "")), None)


# ---------- Tools ----------
def get_services():
    return _services()


def get_availability(service_name: str, stylist_name: str | None = None):
    if not _find_service(service_name):
        return {"error": f"Unknown service '{service_name}'. Options: {[s['name'] for s in _services()]}"}
    slots = db.table("slots").select("date, time, stylist, booked_by").order("id").execute().data
    stylists = sorted({s["stylist"] for s in slots})
    if stylist_name and not any(_norm(s) == _norm(stylist_name) for s in stylists):
        return {"error": f"Unknown stylist '{stylist_name}'. Options: {stylists}"}
    return [
        {"date": s["date"], "time": s["time"], "stylist": s["stylist"]}
        for s in slots
        if s["booked_by"] is None and (not stylist_name or _norm(s["stylist"]) == _norm(stylist_name))
    ]


def book_appointment(service_name: str, stylist_name: str, time_slot: str, customer_name: str):
    service = _find_service(service_name)
    if not service:
        return {"success": False, "error": f"Unknown service '{service_name}'."}
    if not (customer_name or "").strip():
        return {"success": False, "error": "Customer name is required."}
    slot = next(
        (s for s in db.table("slots").select("*").execute().data
         if _norm(s["stylist"]) == _norm(stylist_name) and _norm(s["time"]) == _norm(time_slot)),
        None,
    )
    if not slot:
        return {"success": False, "error": f"{stylist_name} has no slot at {time_slot}."}
    # conditional update is atomic in Postgres: two concurrent bookings can't both win
    booked = (db.table("slots").update({"booked_by": customer_name.strip(), "service": service["name"]})
              .eq("id", slot["id"]).is_("booked_by", "null").execute().data)
    if not booked:
        return {"success": False, "error": f"{slot['time']} with {slot['stylist']} is already booked."}
    slot = booked[0]
    print(f"[DATABASE] Mutating state: Slot {slot['time']} with {slot['stylist']} on {slot['date']} marked as BOOKED.", flush=True)
    return {"success": True, "booking": {**slot, "price": service["price"], "duration_mins": service["duration_mins"]}}


TOOL_FNS = {f.__name__: f for f in (get_services, get_availability, book_appointment)}


def _tool(name, desc, props, required):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": props, "required": required}}}


_str = {"type": "string"}
TOOLS = [
    _tool("get_services", "Fetch the salon's service menu with prices and durations.", {}, []),
    _tool("get_availability", "List open time slots for a service, optionally for one stylist.",
          {"service_name": _str, "stylist_name": _str}, ["service_name"]),
    _tool("book_appointment", "Book a slot. Only call with a time and stylist returned by get_availability.",
          {"service_name": _str, "stylist_name": _str, "time_slot": {"type": "string", "description": "e.g. '10:00 AM'"},
           "customer_name": _str},
          ["service_name", "stylist_name", "time_slot", "customer_name"]),
]

SYSTEM = f"""You are the friendly booking assistant for a hair salon. Today is {date.today().isoformat()}; tomorrow is {TOMORROW}.
Never guess services, prices, or availability: always call the tools. Before booking, make sure you know the service,
stylist, time slot and customer name; ask for whatever is missing. Only report a booking as confirmed if
book_appointment returned success. Keep replies short and plain text (no markdown tables).
Always reply in the language of the user's latest message (service names, stylist names and times stay as the tools return them)."""

# ---------- API ----------
client = Groq(api_key=ENV["groq_api_key"])
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])


def current_user(authorization: str = Header("")):
    """Validate the Supabase access token sent by the frontend."""
    try:
        return db.auth.get_user(authorization.removeprefix("Bearer ")).user
    except Exception:
        raise HTTPException(401, "Please log in again.")


class Msg(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    messages: list[Msg]


def _run_tool(call):
    try:
        args = json.loads(call.function.arguments or "{}")
        print(f"[TOOL CALL] AI requested tool '{call.function.name}' with args: {json.dumps(args)}", flush=True)
        return TOOL_FNS[call.function.name](**args)
    except Exception as e:  # bad JSON / unknown tool / bad args -> let the model recover
        return {"error": str(e)}


def chat_events(history: list[Msg], name: str):
    print(f'[AI INTENT] User sent message: "{history[-1].content}"', flush=True)
    system = SYSTEM + (f"\nThe logged-in customer is {name}; book under that name unless they say otherwise." if name else "")
    messages = [{"role": "system", "content": system}] + [
        m.model_dump() for m in history if m.role in ("user", "assistant")
    ]
    try:
        for _ in range(6):  # cap tool round-trips
            msg = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS, reasoning_format="hidden").choices[0].message
            if not msg.tool_calls:
                reply = msg.content or ""
                break
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in msg.tool_calls]})
            for call in msg.tool_calls:
                yield json.dumps({"type": "tool", "name": call.function.name}) + "\n"
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(_run_tool(call))})
        else:
            reply = "Sorry, I got stuck. Could you rephrase that?"
    except Exception as e:
        print(f"[ERROR] {e}", flush=True)
        reply = "Sorry, the assistant is unavailable right now. Please try again."
    print(f'[AI RESPONSE] Sending reply to frontend: "{reply}"', flush=True)
    yield json.dumps({"type": "reply", "content": reply}) + "\n"


@app.post("/chat")
def chat(body: ChatIn, user=Depends(current_user)):
    name = (user.user_metadata or {}).get("name", "")
    return StreamingResponse(chat_events(body.messages, name), media_type="application/x-ndjson")


@app.post("/transcribe")
def transcribe(audio: UploadFile, user=Depends(current_user)):
    # Whisper auto-detects the spoken language
    data = audio.file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "Recording too long.")
    try:
        text = client.audio.transcriptions.create(model=STT_MODEL, file=(audio.filename or "voice.webm", data)).text
    except Exception as e:
        print(f"[ERROR] transcribe: {e}", flush=True)
        raise HTTPException(502, "Couldn't transcribe that. Please try again.")
    print(f'[VOICE] Transcribed: "{text}"', flush=True)
    return {"text": text.strip()}
