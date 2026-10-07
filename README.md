# Salon AI Booking Assistant

Chat with an AI to browse services, check stylist availability, and book appointments.
The LLM (Groq, `qwen/qwen3.8-27b`) uses tool calling (`get_services`, `get_availability`, `book_appointment`)
against Supabase Postgres (`services`, `slots` tables). Booked slots disappear from later availability checks.
Users sign up / log in with Supabase Auth; the backend rejects requests without a valid access token.
Users pick one of 12 Indian languages first (Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Urdu, Kannada, Malayalam,
Punjabi, Assamese, English); the UI and the assistant's replies follow it. Tap the mic to record: Groq Whisper
(`whisper-large-v3`) transcribes in that language into the input box for review before sending.

## Run

Put keys in `.env` at the repo root (the frontend reads only the URL and publishable key from it):

```
groq_api_key=gsk_...
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

Backend (FastAPI, port 8000):

```
cd backend
uv venv && uv pip install -r requirements.txt
.venv/bin/granian --interface asgi --host 127.0.0.1 --port 8000 main:app
.venv/bin/python test_booking.py   # booking self-check (hits the real DB, frees the slot after)
```

Frontend (Next.js, port 3000):

```
cd frontend
npm install && npm run dev
```

Lint/format: `uvx ruff check . && uvx ruff format .` in `backend/`, `npm run lint` / `npm run format` in `frontend/` (Biome).

Backend console logs every AI step: `[AI INTENT]`, `[TOOL CALL]`, `[DATABASE]`, `[AI RESPONSE]`.
