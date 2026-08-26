from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq

from app.storage import ChatStore

# Load local backend .env first, then workspace-level .env as a fallback.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

MODEL_NAME = os.getenv("CHAT_MODEL", "openai/gpt-oss-120b")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
WEBSITE_NAME = os.getenv("WEBSITE_NAME", "Your Website")
BUSINESS_DOMAIN = os.getenv("BUSINESS_DOMAIN", "general website support")
BRAND_VOICE = os.getenv("BRAND_VOICE", "professional, warm, and concise")
KNOWLEDGE_BASE_SNIPPET = os.getenv("KNOWLEDGE_BASE_SNIPPET", "")
HISTORY_WINDOW = int(os.getenv("CHAT_HISTORY_WINDOW", "10"))

ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()]
ALLOW_CREDENTIALS = ALLOWED_ORIGINS != ["*"]

MODEL_FALLBACKS_RAW = os.getenv(
    "CHAT_MODEL_FALLBACKS",
    "groq/compound,openai/gpt-oss-20b,qwen/qwen3.6-27b",
)
MODEL_FALLBACKS = [m.strip() for m in MODEL_FALLBACKS_RAW.split(",") if m.strip()]

if not GROQ_API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is missing. Add it to chatbot/backend/.env or workspace .env"
    )

client = Groq(api_key=GROQ_API_KEY)
store = ChatStore(Path(__file__).resolve().parents[1] / "chatbot_data.db")

app = FastAPI(title="Website Chatbot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    system_prompt: str | None = None
    website_domain: str | None = None
    page_url: str | None = None
    user_name: str | None = None


class ChatResponse(BaseModel):
    answer: str
    session_id: str


class LeadRequest(BaseModel):
    session_id: str | None = None
    name: str
    email: str
    phone: str | None = None
    note: str | None = None
    consent: bool = True


class LeadResponse(BaseModel):
    status: str
    lead_id: int


def build_system_prompt(req: ChatRequest) -> str:
    dynamic_domain = req.website_domain or BUSINESS_DOMAIN
    user_name_instruction = ""
    if req.user_name:
        user_name_instruction = f"Address the user as {req.user_name} when natural."

    context_instruction = ""
    if KNOWLEDGE_BASE_SNIPPET.strip():
        context_instruction = f"Website knowledge:\n{KNOWLEDGE_BASE_SNIPPET.strip()}"

    page_instruction = ""
    if req.page_url:
        page_instruction = f"User is currently on this page: {req.page_url}."

    return (
        req.system_prompt
        or (
            f"You are the AI assistant for {WEBSITE_NAME}. "
            f"Domain focus: {dynamic_domain}. "
            f"Tone: {BRAND_VOICE}. "
            "Answer accurately, never fabricate product details, "
            "and clearly state when you are unsure. "
            "Keep responses concise unless the user asks for depth. "
            f"{user_name_instruction} {context_instruction} {page_instruction}"
        ).strip()
    )


def resolve_completion(messages: list[dict[str, str]]):
    models_to_try = [MODEL_NAME]
    for candidate in MODEL_FALLBACKS:
        if candidate not in models_to_try:
            models_to_try.append(candidate)

    # Try account-available models as an automatic fallback layer.
    try:
        available = client.models.list()
        for model in available.data:
            model_id = getattr(model, "id", "")
            if model_id and model_id not in models_to_try:
                models_to_try.append(model_id)
    except Exception:
        pass

    last_error = None
    for model in models_to_try:
        try:
            return client.chat.completions.create(
                model=model,
                temperature=0.3,
                messages=messages,
            )
        except Exception as exc:
            last_error = exc

    raise RuntimeError(
        f"All configured models failed. Last error: {last_error}"
    )


@app.get("/api/models")
def list_models() -> dict[str, object]:
    try:
        response = client.models.list()
        model_ids = [getattr(model, "id", "") for model in response.data]
        model_ids = [m for m in model_ids if m]
        return {"count": len(model_ids), "models": model_ids}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not list models: {exc}")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "website_name": WEBSITE_NAME,
        "business_domain": BUSINESS_DOMAIN,
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    session_id = req.session_id or str(uuid4())
    system_prompt = build_system_prompt(req)
    history = store.get_recent_messages(session_id=session_id, limit=HISTORY_WINDOW)

    try:
        messages = [{"role": "system", "content": system_prompt}, *history]
        messages.append({"role": "user", "content": req.message})

        completion = resolve_completion(messages)

        answer = completion.choices[0].message.content or ""
        answer = answer.strip()

        store.add_message(session_id=session_id, role="user", content=req.message)
        store.add_message(session_id=session_id, role="assistant", content=answer)

        return ChatResponse(answer=answer, session_id=session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat generation failed: {exc}")


@app.post("/api/lead", response_model=LeadResponse)
def capture_lead(req: LeadRequest) -> LeadResponse:
    if "@" not in req.email:
        raise HTTPException(status_code=400, detail="A valid email is required")

    if not req.consent:
        raise HTTPException(status_code=400, detail="Consent is required")

    lead_id = store.save_lead(
        session_id=req.session_id,
        name=req.name.strip(),
        email=req.email.strip(),
        phone=(req.phone or "").strip() or None,
        note=(req.note or "").strip() or None,
        captured_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
    )
    return LeadResponse(status="saved", lead_id=lead_id)


@app.get("/api/session/{session_id}")
def session_history(session_id: str) -> dict[str, object]:
    messages = store.get_recent_messages(session_id=session_id, limit=30)
    return {"session_id": session_id, "messages": messages}
