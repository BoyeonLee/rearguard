// RearGuard 챗봇 위젯: Supabase Edge Function(chat)을 호출해 RAG 답변을 보여준다.
(function () {
  const ENDPOINT = "https://mshnrhxrjftrdifenlmu.supabase.co/functions/v1/chat";
  const SUGGESTIONS = [
    "RearGuard는 어떤 제품인가요?",
    "왜 YOLO26n을 선택했나요?",
    "3단계 경고 프로토콜을 설명해 주세요",
    "데이터 전처리는 어떻게 하나요?",
  ];
  const history = [];
  let busy = false;

  const style = document.createElement("style");
  style.textContent = `
    .rg-chat-btn{position:fixed;right:20px;bottom:20px;z-index:60;width:56px;height:56px;border-radius:50%;border:none;
      background:#06b6d4;color:#00424f;box-shadow:0 6px 20px rgba(0,0,0,.45);cursor:pointer;display:flex;align-items:center;justify-content:center}
    .rg-chat-btn:hover{background:#4cd7f6}
    .rg-chat-btn:focus-visible,.rg-chat-panel button:focus-visible,.rg-chat-panel textarea:focus-visible{outline:2px solid #4cd7f6;outline-offset:2px}
    .rg-chat-panel{position:fixed;right:20px;bottom:88px;z-index:60;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));
      display:none;flex-direction:column;background:#181c24;color:#dfe2ee;border:1px solid #3d494c;border-radius:12px;
      box-shadow:0 12px 40px rgba(0,0,0,.55);font-family:Inter,system-ui,sans-serif;overflow:hidden}
    .rg-chat-panel.open{display:flex}
    .rg-chat-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#0a0e16;border-bottom:1px solid #3d494c}
    .rg-chat-head strong{font-size:15px}
    .rg-chat-head span{display:block;font:500 11px 'JetBrains Mono',monospace;color:#869397;margin-top:2px}
    .rg-chat-close{background:none;border:none;color:#bcc9cd;cursor:pointer;font-size:20px;line-height:1;padding:4px 8px}
    .rg-chat-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
    .rg-msg{max-width:85%;padding:10px 12px;border-radius:10px;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
    .rg-msg.user{align-self:flex-end;background:#06b6d4;color:#001f26}
    .rg-msg.bot{align-self:flex-start;background:#262a33}
    .rg-msg.err{align-self:flex-start;background:#93000a;color:#ffdad6}
    .rg-msg.md{white-space:normal}
    .rg-msg.md p,.rg-msg.md ul,.rg-msg.md ol{margin:0}
    .rg-msg.md > * + *{margin-top:8px}
    .rg-msg.md ul,.rg-msg.md ol{padding-left:18px}
    .rg-msg.md ul{list-style:disc}
    .rg-msg.md ol{list-style:decimal}
    .rg-msg.md li + li{margin-top:4px}
    .rg-msg.md strong{color:#fff;font-weight:600}
    .rg-msg.md code{font:12px 'JetBrains Mono',monospace;background:#1c2028;padding:1px 4px;border-radius:4px}
    .rg-chips{display:flex;flex-wrap:wrap;gap:6px}
    .rg-chip{background:#1c2028;color:#4cd7f6;border:1px solid #3d494c;border-radius:16px;padding:6px 10px;font-size:12px;cursor:pointer}
    .rg-chip:hover{border-color:#4cd7f6}
    .rg-typing{align-self:flex-start;color:#869397;font-size:13px}
    .rg-chat-form{display:flex;gap:8px;padding:12px;border-top:1px solid #3d494c;background:#0f131c}
    .rg-chat-form textarea{flex:1;resize:none;height:40px;max-height:96px;padding:9px 10px;border-radius:8px;border:1px solid #3d494c;
      background:#1c2028;color:#dfe2ee;font:14px Inter,system-ui,sans-serif}
    .rg-chat-form button{border:none;border-radius:8px;padding:0 14px;background:#06b6d4;color:#00424f;font-weight:600;cursor:pointer}
    .rg-chat-form button:disabled{opacity:.5;cursor:default}
    .rg-note{font-size:11px;color:#869397;text-align:center;padding:0 12px 8px;background:#0f131c}
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "rg-chat-btn";
  btn.setAttribute("aria-label", "RearGuard 챗봇 열기");
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>';

  const panel = document.createElement("div");
  panel.className = "rg-chat-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "RearGuard 챗봇");
  panel.innerHTML = `
    <div class="rg-chat-head">
      <div><strong>RearGuard 도우미</strong><span>홈페이지·PRD·보고서 기반 답변</span></div>
      <button class="rg-chat-close" aria-label="닫기">×</button>
    </div>
    <div class="rg-chat-body" aria-live="polite"></div>
    <form class="rg-chat-form">
      <textarea placeholder="RearGuard에 대해 물어보세요" maxlength="500" aria-label="질문 입력"></textarea>
      <button type="submit">전송</button>
    </form>
    <div class="rg-note">AI 답변은 부정확할 수 있습니다.</div>`;

  document.body.append(btn, panel);
  const body = panel.querySelector(".rg-chat-body");
  const form = panel.querySelector(".rg-chat-form");
  const input = form.querySelector("textarea");
  const send = form.querySelector("button");

  // 챗봇 답변용 최소 마크다운 렌더러: 굵게, 기울임, 인라인 코드, 글머리/번호 목록, 문단
  // HTML을 먼저 이스케이프한 뒤 태그를 만들므로 답변에 섞인 HTML은 실행되지 않는다.
  function renderMd(text) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    let html = "", list = null, para = [];
    const flushPara = () => {
      if (para.length) html += "<p>" + para.map(inline).join("<br>") + "</p>";
      para = [];
    };
    const closeList = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const m = line.match(/^(?:([-*•])|\d+[.)])\s+(.*)$/);
      if (m) {
        flushPara();
        const type = m[1] ? "ul" : "ol";
        if (list !== type) { closeList(); html += `<${type}>`; list = type; }
        html += `<li>${inline(m[2])}</li>`;
      } else if (!line) {
        flushPara();
        closeList();
      } else {
        closeList();
        para.push(line.replace(/^#{1,6}\s+/, ""));
      }
    }
    flushPara();
    closeList();
    return html;
  }

  function addMsg(text, cls, markdown) {
    const el = document.createElement("div");
    el.className = "rg-msg " + cls;
    if (markdown) {
      el.classList.add("md");
      el.innerHTML = renderMd(text);
    } else {
      el.textContent = text;
    }
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function showWelcome() {
    addMsg("안녕하세요! RearGuard 홈페이지와 PRD, 기술 보고서 내용을 바탕으로 답변해 드립니다.", "bot");
    const chips = document.createElement("div");
    chips.className = "rg-chips";
    SUGGESTIONS.forEach((q) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "rg-chip";
      c.textContent = q;
      c.onclick = () => { chips.remove(); ask(q); };
      chips.appendChild(c);
    });
    body.appendChild(chips);
  }

  async function ask(question) {
    if (busy || !question.trim()) return;
    busy = true;
    send.disabled = true;
    addMsg(question, "user");
    const typing = document.createElement("div");
    typing.className = "rg-typing";
    typing.textContent = "답변을 작성하는 중…";
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok) {
        addMsg(data.error || "오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", "err");
      } else {
        addMsg(data.answer, "bot", true);
        history.push({ role: "user", text: question }, { role: "model", text: data.answer });
        history.splice(0, Math.max(0, history.length - 4));
      }
    } catch {
      typing.remove();
      addMsg("서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.", "err");
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  btn.onclick = () => {
    const open = panel.classList.toggle("open");
    btn.setAttribute("aria-label", open ? "RearGuard 챗봇 닫기" : "RearGuard 챗봇 열기");
    if (open && !body.childElementCount) showWelcome();
    if (open) input.focus();
  };
  panel.querySelector(".rg-chat-close").onclick = () => btn.click();
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = "";
    ask(q);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
})();
