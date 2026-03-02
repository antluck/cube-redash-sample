#!/usr/bin/env python3
"""AI BI Consultant backend — FastAPI + Claude Agent SDK.

Receives Redash query results, analyzes them with Claude,
and streams back structured insights via SSE.

Usage:
    uvicorn server:app --host 127.0.0.1 --port 8787 --reload
"""

import json
import os
import time

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
    query,
)

from prompt import (
    ANALYSIS_SCHEMA,
    NL2SQL_RESPONSE_SCHEMA,
    NL2SQL_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_schema_text,
)

app = FastAPI(title="AI BI Consultant")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    query: str
    columns: list[str]
    rows: list[dict]
    metadata: dict | None = None


def format_as_markdown_table(columns: list[str], rows: list[dict]) -> str:
    """Convert columns + rows to a markdown table string."""
    if not rows:
        return "(データなし)"
    header = "| " + " | ".join(columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    lines = [header, separator]
    for row in rows:
        cells = [str(row.get(c, "")) for c in columns]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    total_rows = len(req.rows)
    display_rows = req.rows[:200]
    table = format_as_markdown_table(req.columns, display_rows)

    truncation_note = ""
    if total_rows > 200:
        truncation_note = f"\n\n注意: 元データは{total_rows}行ですが、最初の200行を表示しています。"

    user_prompt = f"""\
以下のクエリ結果を分析してください。

## 実行クエリ
```sql
{req.query}
```

## データ（{total_rows}行）
{table}{truncation_note}

データを深く分析し、summary, insights, charts, actions を返してください。"""

    async def stream():
        options = ClaudeAgentOptions(
            system_prompt=SYSTEM_PROMPT,
            tools=[],
            max_turns=1,
            model="claude-sonnet-4-5",
            max_thinking_tokens=10000,
            output_format={"type": "json_schema", "schema": ANALYSIS_SCHEMA},
        )

        structured_result = None
        try:
            async for message in query(prompt=user_prompt, options=options):
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, ThinkingBlock):
                            chunk = json.dumps(
                                {"type": "thinking", "text": block.thinking},
                                ensure_ascii=False,
                            )
                            yield f"data: {chunk}\n\n"
                        elif isinstance(block, TextBlock):
                            chunk = json.dumps(
                                {"type": "partial", "text": block.text},
                                ensure_ascii=False,
                            )
                            yield f"data: {chunk}\n\n"
                        elif isinstance(block, ToolUseBlock) and block.name == "StructuredOutput":
                            structured_result = block.input
                elif isinstance(message, ResultMessage):
                    # Prefer ToolUseBlock input; fall back to ResultMessage.structured_output
                    result = structured_result or getattr(message, "structured_output", None)
                    if not result or not isinstance(result, dict):
                        result = {
                            "summary": "(分析結果なし)",
                            "insights": [],
                            "charts": [],
                            "actions": [],
                        }
                    done = json.dumps(
                        {"type": "complete", "data": result}, ensure_ascii=False
                    )
                    yield f"data: {done}\n\n"
        except Exception as e:
            err = json.dumps(
                {"type": "error", "message": str(e)}, ensure_ascii=False
            )
            yield f"data: {err}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── NL → Cube SQL ────────────────────────────────────────────────

CUBE_API = os.environ.get("CUBE_API_URL", "http://localhost:4000/cubejs-api/v1")
_cube_meta_cache: dict = {"data": None, "ts": 0.0}


async def get_cube_meta() -> dict:
    """Fetch Cube /meta with 5-minute cache."""
    now = time.time()
    if _cube_meta_cache["data"] and (now - _cube_meta_cache["ts"]) < 300:
        return _cube_meta_cache["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{CUBE_API}/meta")
        resp.raise_for_status()
        meta = resp.json()
    _cube_meta_cache["data"] = meta
    _cube_meta_cache["ts"] = now
    return meta


class NL2SQLRequest(BaseModel):
    question: str


@app.post("/nl2sql")
async def nl2sql(req: NL2SQLRequest):
    meta = await get_cube_meta()
    schema_text = build_schema_text(meta)
    system = NL2SQL_SYSTEM_PROMPT.replace("{schema_text}", schema_text)

    options = ClaudeAgentOptions(
        system_prompt=system,
        tools=[],
        max_turns=1,
        model="claude-sonnet-4-5",
        output_format={"type": "json_schema", "schema": NL2SQL_RESPONSE_SCHEMA},
    )

    result_data = None
    try:
        async for message in query(prompt=req.question, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, ToolUseBlock) and block.name == "StructuredOutput":
                        result_data = block.input
            elif isinstance(message, ResultMessage):
                result_data = result_data or getattr(message, "structured_output", None)
    except Exception as e:
        return {"sql": "", "explanation": str(e), "error": True}

    if not result_data or "sql" not in result_data:
        return {"sql": "", "explanation": "SQL生成に失敗しました", "error": True}

    sql = result_data["sql"].strip()
    if sql.startswith("```"):
        sql = sql.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    return {
        "sql": sql,
        "explanation": result_data.get("explanation", ""),
        "error": False,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787)
