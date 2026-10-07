# Salon AI Booking Assistant

Chat with an AI to browse services, check stylist availability, and book appointments.
The LLM (Groq, `openai/gpt-oss-120b`) uses tool calling (`get_services`, `get_availability`, `book_appointment`)
against an in-memory store. Booked slots disappear from later availability checks.

## Run

Put your Groq key in `.env` at the repo root:

```
groq_api_key=gsk_...
```

Backend (FastAPI, port 8000):

```
cd backend
uv venv && uv pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8000
.venv/bin/python test_booking.py   # booking self-check
```

Frontend (Next.js, port 3000):

```
cd frontend
npm install && npm run dev
```

Backend console logs every AI step: `[AI INTENT]`, `[TOOL CALL]`, `[DATABASE]`, `[AI RESPONSE]`.
