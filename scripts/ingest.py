"""RearGuard 홈페이지·PRD·report 문서를 청크로 나눠 Gemini로 임베딩한 뒤 Supabase에 적재한다.

사용법 (rearguard 폴더에서):
    python scripts/ingest.py --dry-run   # API 호출 없이 청크 결과만 확인
    python scripts/ingest.py             # 임베딩 생성 후 테이블을 비우고 다시 적재

필요한 .env 값: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
표준 라이브러리만 사용하므로 별도 설치가 필요 없다.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ["index.html", "vision-review.html", "PRD/PRD.md", "report/*.md"]

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIM = 768
EMBED_BATCH = 10      # 무료 등급 한도를 고려해 작게 나눠 보낸다
EMBED_PAUSE = 3       # 배치 사이 대기(초)
CHUNK_MAX = 900       # 청크 최대 글자 수
CHUNK_OVERLAP = 150   # 다음 청크로 이어 붙일 앞 청크의 꼬리 길이
CHUNK_MIN = 40        # 이보다 짧은 청크는 버린다


def load_env():
    env = {}
    for raw in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f".env에 {k} 값이 없습니다.")
    return env


# ---------- HTML: <section> 단위로 본문 텍스트 추출 ----------

class SectionParser(HTMLParser):
    SKIP = {"script", "style", "svg", "noscript", "header", "footer", "nav", "button"}
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "tr", "br", "section", "ul", "ol", "table"}
    VOID = {"img", "br", "hr", "meta", "link", "input", "source", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sections = []      # [(title, text)]
        self.cur = None         # 현재 section의 텍스트 조각
        self.title = None
        self.heading = None     # 수집 중인 h1/h2 텍스트
        self.skip = []          # 건너뛰는 요소의 태그 스택

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            if tag == "br" and self.cur is not None and not self.skip:
                self.cur.append("\n")
            return
        cls = dict(attrs).get("class") or ""
        if self.skip:
            self.skip.append(tag)
            return
        if tag in self.SKIP or "material-symbols" in cls:
            self.skip.append(tag)
            return
        if tag == "section":
            self.cur, self.title = [], None
        elif tag in ("h1", "h2") and self.cur is not None and self.title is None:
            self.heading = []
        if tag in self.BLOCK and self.cur is not None:
            self.cur.append("\n")
        elif tag == "td" and self.cur is not None:
            self.cur.append(" | ")

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        if self.skip:
            self.skip.pop()
            return
        if tag in ("h1", "h2") and self.heading is not None:
            self.title = re.sub(r"\s+", " ", "".join(self.heading)).strip()
            self.heading = None
        if tag in self.BLOCK and self.cur is not None:
            self.cur.append("\n")
        if tag == "section" and self.cur is not None:
            text = clean("".join(self.cur))
            if text:
                self.sections.append((self.title or "소개", text))
            self.cur = None

    def handle_data(self, data):
        if self.skip or self.cur is None:
            return
        self.cur.append(data)
        if self.heading is not None:
            self.heading.append(data)


def clean(text):
    lines = [re.sub(r"[ \t ]+", " ", l).strip(" |") for l in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(l for l in lines if l)).strip()


def parse_html(path):
    p = SectionParser()
    p.feed(path.read_text(encoding="utf-8"))
    return p.sections


# ---------- Markdown: 헤딩 단위로 분할 ----------

def parse_md(path):
    sections, stack, buf, in_code = [], [], [], False

    def flush():
        text = clean("\n".join(buf))
        if text:
            sections.append((" > ".join(stack) or path.stem, text))
        buf.clear()

    for line in path.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("```"):
            in_code = not in_code
        m = None if in_code else re.match(r"^(#{1,4})\s+(.*)", line)
        if m:
            flush()
            level, heading = len(m.group(1)), m.group(2).strip().strip("*")
            stack[:] = stack[: level - 1] + [heading]
        else:
            buf.append(line)
    flush()
    return sections


# ---------- 청킹 ----------

def split_text(text):
    if len(text) <= CHUNK_MAX:
        return [text]
    chunks, cur = [], ""
    for para in re.split(r"\n+", text):
        while len(para) > CHUNK_MAX:            # 아주 긴 문단은 강제로 자른다
            head, para = para[:CHUNK_MAX], para[CHUNK_MAX:]
            if cur:
                chunks.append(cur)
                cur = cur[-CHUNK_OVERLAP:]
            chunks.append((cur + "\n" + head).strip())
            cur = head[-CHUNK_OVERLAP:]
        if cur and len(cur) + len(para) + 1 > CHUNK_MAX:
            chunks.append(cur)
            cur = cur[-CHUNK_OVERLAP:]
        cur = (cur + "\n" + para).strip()
    if cur:
        chunks.append(cur)
    return chunks


def build_chunks():
    files = []
    for pattern in SOURCES:
        files += sorted(ROOT.glob(pattern))
    rows = []
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        sections = parse_html(f) if f.suffix == ".html" else parse_md(f)
        for title, text in sections:
            for i, chunk in enumerate(split_text(text)):
                if len(chunk) >= CHUNK_MIN:
                    rows.append({"source": rel, "title": title, "chunk_index": i, "content": chunk})
    return rows


# ---------- API 호출 ----------

def request(url, body=None, headers=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def embed_batch(texts, key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents"
    body = {"requests": [{
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": t}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": EMBED_DIM,
    } for t in texts]}
    for attempt in range(6):
        try:
            res = request(url, body, {"x-goog-api-key": key})
            return [e["values"] for e in res["embeddings"]]
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 5:
                wait = 20 * (attempt + 1)
                print(f"  Gemini {e.code}: {wait}초 후 재시도")
                time.sleep(wait)
                continue
            sys.exit(f"Gemini 오류 {e.code}: {e.read().decode()[:300]}")


def main():
    rows = build_chunks()
    by_source = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    print(f"청크 {len(rows)}개")
    for s, n in by_source.items():
        print(f"  {s}: {n}")

    if "--dry-run" in sys.argv:
        for r in rows[:3]:
            print("\n---", r["source"], "|", r["title"], "\n", r["content"][:300])
        return

    env = load_env()
    for i in range(0, len(rows), EMBED_BATCH):
        batch = rows[i:i + EMBED_BATCH]
        texts = [f"{r['source']} - {r['title']}\n\n{r['content']}" for r in batch]
        for r, vec in zip(batch, embed_batch(texts, env["GEMINI_API_KEY"])):
            r["embedding"] = "[" + ",".join(f"{x:.7f}" for x in vec) + "]"
        print(f"  임베딩 {min(i + EMBED_BATCH, len(rows))}/{len(rows)}")
        if i + EMBED_BATCH < len(rows):
            time.sleep(EMBED_PAUSE)

    # 임베딩이 모두 성공한 뒤에만 기존 데이터를 지우고 새로 넣는다
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/rearguard_docs"
    headers = {"apikey": env["SUPABASE_SERVICE_ROLE_KEY"], "Prefer": "return=minimal"}
    try:
        request(base + "?id=gte.0", headers=headers, method="DELETE")
        for i in range(0, len(rows), 50):
            request(base, rows[i:i + 50], headers, method="POST")
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase 오류 {e.code}: {e.read().decode()[:300]}")
    print(f"완료: {len(rows)}개 행을 rearguard_docs에 적재했습니다.")


if __name__ == "__main__":
    main()
