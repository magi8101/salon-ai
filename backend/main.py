import json
import threading
from datetime import date, timedelta
from pathlib import Path

from dotenv import dotenv_values
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import Groq
from pydantic import BaseModel

MODEL = "openai/gpt-oss-120b"
TOMORROW = (date.today() + timedelta(days=1)).isoformat()

# ---------- In-memory data ----------
SERVICES = [
    {"name": "Haircut", "price": 40, "duration_mins": 30},
    {"name": "Hair Coloring", "price": 100, "duration_mins": 60},
    {"name": "Facial", "price": 60, "duration_mins": 45},
]
STYLISTS = ["Alex", "Jordan", "Taylor"]
# ponytail: any stylist does any service and a slot is a single start time (duration not blocked out);
# add per-stylist skills / overlap checks if the salon needs them.
SLOTS = [
    {"date": TOMORROW, "time": t, "stylist": s, "booked_by": None, "service": None}
    for s, times in {
        "Alex": ["10:00 AM", "1:00 PM", "3:30 PM"],
        "Jordan": ["10:00 AM", "3:30 PM"],
        "Taylor": ["1:00 PM", "3:30 PM"],
    }.items()
    for t in times
]
_lock = threading.Lock()


def _norm(s: str) -> str:
    return s.lower().replace(" ", "").replace(":00", "")


def _find_service(name: str):
    return next((s for s in SERVICES if _norm(s["name"]) == _norm(name or "")), None)


# ---------- Tools ----------
def get_services():
    return SERVICES


def get_availability(service_name: str, stylist_name: str | None = None):
    if not _find_service(service_name):
        return {"error": f"Unknown service '{service_name}'. Options: {[s['name'] for s in SERVICES]}"}
    if stylist_name and stylist_name.capitalize() not in STYLISTS:
        return {"error": f"Unknown stylist '{stylist_name}'. Options: {STYLISTS}"}
    return [
        {"date": s["date"], "time": s["time"], "stylist": s["stylist"]}
        for s in SLOTS
        if s["booked_by"] is None and (not stylist_name or _norm(s["stylist"]) == _norm(stylist_name))
    ]


def book_appointment(service_name: str, stylist_name: str, time_slot: str, customer_name: str):
    service = _find_service(service_name)
    if not service:
        return {"success": False, "error": f"Unknown service '{service_name}'."}
    if not (customer_name or "").strip():
        return {"success": False, "error": "Customer name is required."}
    with _lock:
        slot = next(
            (s for s in SLOTS if _norm(s["stylist"]) == _norm(stylist_name) and _norm(s["time"]) == _norm(time_slot)),
            None,
        )
        if not slot:
            return {"success": False, "error": f"{stylist_name} has no slot at {time_slot}."}
        if slot["booked_by"]:
            return {"success": False, "error": f"{slot['time']} with {slot['stylist']} is already booked."}
        slot["booked_by"], slot["service"] = customer_name.strip(), service["name"]
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
book_appointment returned success. Keep replies short and plain text (no markdown tables)."""

# ---------- API ----------
client = Groq(api_key=dotenv_values(Path(__file__).parent.parent / ".env")["groq_api_key"])
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])


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


def chat_events(history: list[Msg]):
    print(f'[AI INTENT] User sent message: "{history[-1].content}"', flush=True)
    messages = [{"role": "system", "content": SYSTEM}] + [
        m.model_dump() for m in history if m.role in ("user", "assistant")
    ]
    try:
        for _ in range(6):  # cap tool round-trips
            msg = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS).choices[0].message
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
def chat(body: ChatIn):
    return StreamingResponse(chat_events(body.messages), media_type="application/x-ndjson")
