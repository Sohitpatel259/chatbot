(function () {
  const scriptTag =
    document.currentScript ||
    document.querySelector('script[data-chatbot-widget="true"]') ||
    document.querySelector('script[src*="chatbot-widget.js"]');

  const apiBase =
    (scriptTag && scriptTag.dataset.api) || "http://127.0.0.1:8000";
  const title =
    (scriptTag && scriptTag.dataset.title) || "Ask Our Assistant";
  const firstMessage =
    (scriptTag && scriptTag.dataset.welcome) ||
    "Hi! I can help with your questions.";
  const websiteDomain =
    (scriptTag && scriptTag.dataset.domain) || window.location.hostname;
  const leadCtaAfter = Number(
    (scriptTag && scriptTag.dataset.leadAfterMessages) || 4
  );
  const showLeadCapture =
    (scriptTag && scriptTag.dataset.leadCapture || "true").toLowerCase() !==
    "false";
  const cssUrl =
    (scriptTag && scriptTag.dataset.css) ||
    (scriptTag && scriptTag.src
      ? new URL("chatbot-widget.css", scriptTag.src).toString()
      : "./chatbot-widget.css");

  const sessionKey = "chatbot_session_id";
  let sessionId = localStorage.getItem(sessionKey) || null;
  let userMsgCount = 0;
  let leadCaptured = localStorage.getItem("chatbot_lead_captured") === "true";

  function ensureStyles() {
    if (document.getElementById("chatbot-widget-css")) {
      return;
    }

    const link = document.createElement("link");
    link.id = "chatbot-widget-css";
    link.rel = "stylesheet";
    link.href = cssUrl;
    document.head.appendChild(link);
  }

  function appendMessage(container, text, role) {
    const bubble = document.createElement("div");
    bubble.className = `cb-msg ${role === "user" ? "cb-user" : "cb-bot"}`;
    bubble.textContent = text;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  async function askBot(message, userName) {
    const response = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        website_domain: websiteDomain,
        page_url: window.location.href,
        user_name: userName || undefined,
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(txt || "Request failed");
    }

    const data = await response.json();
    if (data && data.session_id) {
      sessionId = data.session_id;
      localStorage.setItem(sessionKey, sessionId);
    }
    return data;
  }

  async function submitLead(payload) {
    const response = await fetch(`${apiBase}/api/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, session_id: sessionId }),
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(txt || "Lead capture failed");
    }

    return response.json();
  }

  function openLeadModal() {
    const overlay = document.createElement("div");
    overlay.className = "cb-lead-overlay";
    overlay.innerHTML = `
      <div class="cb-lead-modal" role="dialog" aria-label="Share contact details">
        <h3>Get a call back</h3>
        <p>Share your details and our team will contact you.</p>
        <form class="cb-lead-form">
          <input class="cb-lead-input" name="name" placeholder="Full name" required />
          <input class="cb-lead-input" name="email" type="email" placeholder="Email" required />
          <input class="cb-lead-input" name="phone" placeholder="Phone (optional)" />
          <textarea class="cb-lead-input" name="note" rows="3" placeholder="What do you need help with?"></textarea>
          <label class="cb-lead-consent">
            <input type="checkbox" name="consent" checked required />
            I agree to be contacted.
          </label>
          <div class="cb-lead-actions">
            <button type="button" class="cb-lead-cancel">Later</button>
            <button type="submit" class="cb-lead-submit">Submit</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const form = overlay.querySelector(".cb-lead-form");
    const cancel = overlay.querySelector(".cb-lead-cancel");

    cancel.addEventListener("click", () => overlay.remove());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: String(fd.get("name") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        phone: String(fd.get("phone") || "").trim(),
        note: String(fd.get("note") || "").trim(),
        consent: Boolean(fd.get("consent")),
      };

      try {
        await submitLead(payload);
        leadCaptured = true;
        localStorage.setItem("chatbot_lead_captured", "true");
        overlay.remove();
      } catch (error) {
        console.error(error);
        alert("Could not submit details right now. Please try again.");
      }
    });
  }

  function mount() {
    ensureStyles();

    const root = document.createElement("div");
    root.id = "chatbot-root";

    const launcher = document.createElement("button");
    launcher.className = "cb-launcher";
    launcher.type = "button";
    launcher.title = "Open chat";
    launcher.textContent = "✦";

    const panel = document.createElement("section");
    panel.className = "cb-panel";

    panel.innerHTML = `
      <header class="cb-header">
        <div class="cb-title">${title}</div>
        <button class="cb-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="cb-messages"></div>
      <form class="cb-input-wrap">
        <input class="cb-input" type="text" placeholder="Type your message..." autocomplete="off" />
        <button class="cb-send" type="submit">Send</button>
      </form>
    `;

    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    const closeBtn = panel.querySelector(".cb-close");
    const messages = panel.querySelector(".cb-messages");
    const form = panel.querySelector(".cb-input-wrap");
    const input = panel.querySelector(".cb-input");
    const sendBtn = panel.querySelector(".cb-send");

    let detectedName = "";

    appendMessage(messages, firstMessage, "bot");

    launcher.addEventListener("click", () => {
      panel.classList.add("open");
      input.focus();
    });

    closeBtn.addEventListener("click", () => {
      panel.classList.remove("open");
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message) {
        return;
      }

      appendMessage(messages, message, "user");
      userMsgCount += 1;

      // Soft name extraction from short intros like "I am Priya".
      if (!detectedName) {
        const nameMatch = message.match(/\b(?:i am|i'm|my name is)\s+([a-z][a-z\s'-]{1,30})/i);
        if (nameMatch) {
          detectedName = nameMatch[1].trim();
        }
      }

      input.value = "";
      sendBtn.disabled = true;

      try {
        const data = await askBot(message, detectedName);
        appendMessage(messages, data.answer || "No response received.", "bot");

        if (
          showLeadCapture &&
          !leadCaptured &&
          userMsgCount >= leadCtaAfter
        ) {
          openLeadModal();
        }
      } catch (error) {
        appendMessage(
          messages,
          "Sorry, the assistant is temporarily unavailable. Please try again.",
          "bot"
        );
        console.error(error);
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
