"""System prompt and response schema for the AI BI Consultant.

Exports:
  - SYSTEM_PROMPT / ANALYSIS_SCHEMA  — for /analyze (data analysis)
  - NL2SQL_SYSTEM_PROMPT / NL2SQL_RESPONSE_SCHEMA / build_schema_text — for /nl2sql
"""

SYSTEM_PROMPT = """\
あなたは経験豊富なデータアナリスト・コンサルタントです。
クライアントから提供されたクエリ結果を分析し、ビジネスインサイトと具体的なアクションを提案してください。

## あなたの役割
- データの傾向、異常値、パターンを発見する
- ビジネス視点で意味のある解釈を提供する
- 具体的で実行可能な「次に取るべき行動」を提案する
- 可視化に適したチャート仕様を生成する

## 分析の観点
1. **概要把握**: データ全体の傾向・特徴を要約
2. **深掘り分析**: 異常値、相関、セグメント間の差異を発見
3. **ビジネスインサイト**: 数字の裏にある「なぜ」を考察
4. **アクション提案**: データに基づく具体的な施策を提案

## 出力ルール
- すべて日本語で回答する
- 数値は具体的に引用する（「多い」ではなく「25,107件で全体の32%」のように）
- chartsのdatasetsにはlabel, data, backgroundColor, borderColorを含める
- actionsには優先度（high/medium/low）と根拠を必ず含める
- insightsのseverityは: 情報的な発見=info、注意すべき傾向=warning、即対応が必要=critical

## チャート生成ガイドライン
- データの特性に合ったチャートタイプを選択する
- 比較: bar、時系列: line、構成比: pie/doughnut、相関: scatter
- 色はダークテーマ用の明るい色: #38bdf8, #4ade80, #fbbf24, #fb7185, #a78bfa, #f472b6
- labelsとdatasetsのdata配列は同じ長さにする
- チャートは最大3つまで（最も重要なものを選ぶ）
"""

# ── NL → Cube SQL ────────────────────────────────────────────────

NL2SQL_SYSTEM_PROMPT = """\
あなたはCube.jsセマンティックレイヤーのSQLジェネレーターです。
ユーザーの自然言語の質問を、Cube SQL互換のSELECT文に変換してください。

## ルール
- テーブル名・カラム名はダブルクォートで囲む: "CubeName"."memberName"
- measureはSELECT句にそのまま書く（Cube.jsが自動集計する）
- dimensionはSELECT句に書く（GROUP BYは不要、Cube.jsが自動付与）
- ORDER BY, LIMIT, WHEREは標準SQL構文を使用
- 存在しないCubeやメンバーは絶対に使わない
- JOINは不要（各Cubeは独立したテーブルとして扱う）

## 利用可能なCubeスキーマ
{schema_text}

## 出力
sqlフィールドにSQLのみ（コードフェンス不要）、explanationフィールドに日本語の簡潔な説明。
"""


def build_schema_text(meta_json: dict) -> str:
    """Convert Cube /meta API response into readable schema text for the LLM."""
    lines = []
    for cube in meta_json.get("cubes", []):
        name = cube["name"]
        lines.append(f"### {name}")
        if cube.get("measures"):
            lines.append("  Measures:")
            for m in cube["measures"]:
                mname = m["name"].split(".")[-1] if "." in m["name"] else m["name"]
                lines.append(f'    - "{name}"."{mname}" ({m.get("type", "?")})')
        if cube.get("dimensions"):
            lines.append("  Dimensions:")
            for d in cube["dimensions"]:
                dname = d["name"].split(".")[-1] if "." in d["name"] else d["name"]
                lines.append(f'    - "{name}"."{dname}" ({d.get("type", "?")})')
        lines.append("")
    return "\n".join(lines)


NL2SQL_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {
            "type": "string",
            "description": "Cube SQL互換のSELECT文",
        },
        "explanation": {
            "type": "string",
            "description": "生成したSQLの簡単な説明（日本語）",
        },
    },
    "required": ["sql", "explanation"],
}

# ── Data Analysis ────────────────────────────────────────────────

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "データ全体の傾向を1-3文で要約（日本語）",
        },
        "insights": {
            "type": "array",
            "description": "発見したインサイト（3-5個）",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "インサイトのタイトル"},
                    "description": {
                        "type": "string",
                        "description": "具体的な数値を含む詳細説明",
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["info", "warning", "critical"],
                    },
                },
                "required": ["title", "description", "severity"],
            },
        },
        "charts": {
            "type": "array",
            "description": "Chart.js v4互換のチャート仕様（1-3個）",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["bar", "line", "pie", "doughnut", "scatter"],
                    },
                    "title": {"type": "string"},
                    "labels": {"type": "array", "items": {"type": "string"}},
                    "datasets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "data": {
                                    "type": "array",
                                    "items": {"type": "number"},
                                },
                                "backgroundColor": {},
                                "borderColor": {},
                            },
                            "required": ["label", "data"],
                        },
                    },
                },
                "required": ["type", "title", "labels", "datasets"],
            },
        },
        "actions": {
            "type": "array",
            "description": "次に取るべき行動（2-4個）",
            "items": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "具体的なアクション"},
                    "priority": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "rationale": {
                        "type": "string",
                        "description": "データに基づく根拠",
                    },
                },
                "required": ["action", "priority", "rationale"],
            },
        },
    },
    "required": ["summary", "insights", "charts", "actions"],
}
