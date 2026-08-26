# Website Chatbot (FastAPI + Groq)

This is a complete chatbot package you can plug into your website.

## 1) Project Structure

- `backend/` FastAPI API that calls Groq chat models
- `frontend/` embeddable chat widget (JS + CSS)

Features added:
- Personality/domain customization via environment variables
- Session conversation memory persisted in SQLite
- Lead capture form and API (`/api/lead`)
- Production deployment configs (Render, Railway, Docker/VPS)

## 2) Create Separate Virtual Environment

From `chatbot/backend` run:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 3) Configure API Key

Your workspace already has a root `.env`. The backend reads both:
- `chatbot/backend/.env`
- workspace root `.env`

Optional local backend `.env` file:

```env
GROQ_API_KEY=your_key_here
CHAT_MODEL=openai/gpt-oss-120b
CHAT_MODEL_FALLBACKS=groq/compound,openai/gpt-oss-20b,qwen/qwen3.6-27b
WEBSITE_NAME=Your Website
BUSINESS_DOMAIN=products, pricing, support
BRAND_VOICE=professional, warm, and concise
KNOWLEDGE_BASE_SNIPPET=Key facts and FAQ text
CHAT_HISTORY_WINDOW=10
ALLOWED_ORIGINS=*
```

## 4) Run API

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
cd C:\Users\Asus\OneDrive\Desktop\chatbot\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
Health check:

```text
http://127.0.0.1:8000/health
```
frontend:- 
cd C:\Users\Asus\OneDrive\Desktop\chatbot
py -m http.server 5500 --directory frontend

link:-http://127.0.0.1:5500/demo.html
## 5) Embed In Your Website

Copy `frontend/chatbot-widget.js` and `frontend/chatbot-widget.css` to your website static assets.

Then add this snippet near `</body>`:

```html
<script
  src="/assets/chatbot-widget.js"
  data-api="http://127.0.0.1:8000"
  data-title="Website Assistant"
  data-welcome="Hi! Ask me anything about this website."
  data-domain="your exact business domain"
  data-lead-capture="true"
  data-lead-after-messages="4"
  defer
></script>
```

If your site is on a different domain, keep CORS enabled in the backend as currently configured.

## 6) Endpoints

- `POST /api/chat`
- `POST /api/lead`
- `GET /api/session/{session_id}`
- `GET /api/models`
- `GET /health`

The chat endpoint first tries `CHAT_MODEL`, then `CHAT_MODEL_FALLBACKS`, then auto-tries models available for your Groq account.

## 7) Deployment

Render:
- Use `backend/render.yaml` (infrastructure as code)

Railway:
- Use `backend/railway.json`

VPS / Docker:

```powershell
docker build -t website-chatbot-api ./backend
docker run --env-file ./backend/.env -p 8000:8000 website-chatbot-api
```

## Recommended Model

Default model is:
- `openai/gpt-oss-120b`

If the first model is unavailable, the backend will auto-try models from `CHAT_MODEL_FALLBACKS`.
