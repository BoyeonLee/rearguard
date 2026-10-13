// RearGuard 챗봇: 질문 임베딩 → pgvector 검색 → Gemini 답변 생성
import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const EMBED_MODEL = "gemini-embedding-001";
const CHAT_MODEL = "gemini-2.5-flash";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

const ALLOWED_ORIGINS = [
  "https://boyeonlee.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];
const MAX_QUESTION = 500;   // 질문 최대 글자 수
const MAX_HISTORY = 4;      // 함께 보낼 이전 메시지 수 (2턴)

const SYSTEM_PROMPT = `너는 RearGuard(자전거 후방 위험 경고 엣지 AI 시스템) 홈페이지의 안내 챗봇이다.
규칙:
- 반드시 아래 [참고 자료]에 있는 내용만 근거로 한국어로 답한다.
- 자료에 없는 내용은 추측하지 말고 "홈페이지 자료에서는 확인되지 않습니다."라고 답한다.
- 3~5문장 이내로 핵심만 간결하게 답한다. 목록이 필요하면 최대 4개 항목까지만 쓴다.
- 마크다운 표나 제목은 쓰지 않는다.`;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

class GeminiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function gemini(path: string, body: unknown) {
  const res = await fetch(`${GEMINI}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new GeminiError(res.status, await res.text());
  return res.json();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST만 지원합니다." }, 405);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "허용되지 않은 출처입니다." }, 403);

  try {
    const { question, history } = await req.json();
    const q = typeof question === "string" ? question.trim() : "";
    if (!q) return json({ error: "질문을 입력해 주세요." }, 400);
    if (q.length > MAX_QUESTION) return json({ error: `질문은 ${MAX_QUESTION}자 이내로 입력해 주세요.` }, 400);

    // 1) 질문 임베딩
    const emb = await gemini(`${EMBED_MODEL}:embedContent`, {
      content: { parts: [{ text: q }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    });

    // 2) 유사 청크 검색
    const { data: docs, error } = await supabase.rpc("match_rearguard_docs", {
      query_embedding: emb.embedding.values,
      match_count: 5,
      match_threshold: 0.5,
    });
    if (error) throw error;

    const context = (docs ?? [])
      .map((d: { source: string; title: string; content: string }, i: number) =>
        `[${i + 1}] (${d.source} · ${d.title})\n${d.content}`)
      .join("\n\n");

    // 3) 답변 생성 (최근 대화 일부만 포함)
    const past = (Array.isArray(history) ? history : [])
      .filter((m) => m && typeof m.text === "string" && (m.role === "user" || m.role === "model"))
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, parts: [{ text: String(m.text).slice(0, 800) }] }));

    const gen = await gemini(`${CHAT_MODEL}:generateContent`, {
      systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n[참고 자료]\n${context || "(관련 자료 없음)"}` }] },
      contents: [...past, { role: "user", parts: [{ text: q }] }],
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const answer = gen.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim()
      || "답변을 생성하지 못했습니다. 다시 시도해 주세요.";

    const sources = [...new Map((docs ?? []).map((d: { source: string; title: string }) =>
      [`${d.source}|${d.title}`, { source: d.source, title: d.title }])).values()].slice(0, 3);

    return json({ answer, sources });
  } catch (e) {
    if (e instanceof GeminiError && e.status === 429) {
      return json({ error: "요청이 많아 잠시 쉬는 중입니다. 1분 후 다시 시도해 주세요." }, 429);
    }
    console.error(e);
    return json({ error: "일시적인 오류가 발생했습니다." }, 500);
  }
});
