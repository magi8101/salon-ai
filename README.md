# Salon AI Booking Assistant

Chat with an AI to browse services, check stylist availability, and book appointments.
The LLM (Groq, `qwen/qwen3.8-27b`) uses tool calling (`get_services`, `get_availability`, `book_appointment`)
against Supabase Postgres (`services`, `slots` tables). Booked slots disappear from later availability checks.
Users sign up / log in with Supabase Auth; the backend rejects requests without a valid access token.
Voice input is transcribed by Groq Whisper (`whisper-large-v3`); the assistant replies in whatever language you use.

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
.venv/bin/uvicorn main:app --port 8000
.venv/bin/python test_booking.py   # booking self-check (hits the real DB, frees the slot after)
```

Frontend (Next.js, port 3000):

```
cd frontend
npm install && npm run dev
```

Backend console logs every AI step: `[AI INTENT]`, `[TOOL CALL]`, `[DATABASE]`, `[AI RESPONSE]`.
