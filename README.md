# Cube Analytics

DuckDB + Cube.js + Redash + AI Consultant のデモスタック。
`docker compose up` だけで MovieLens データの分析環境が立ち上がる。

## Architecture

```
MovieLens CSV ──→ DuckDB ──→ dbt marts ──→ Cube.js (semantic layer)
                                              │
                    ┌─────────────────────────┼────────────────────┐
                    │                         │                    │
              BI Dashboard            AI Consultant          DuckDB Server
              (nginx:8080)          (FastAPI:8787)         (PG wire:5433)
                                    ├─ /analyze (SSE)           │
                                    └─ /nl2sql             Redash (5050)
                                                           + Chrome 拡張
```

## Quick Start

```bash
# 1. Clone
git clone https://github.com/antluck/cube-redash-sample.git
cd cube-analytics

# 2. Configure AI credentials (required for AI features)
cp .env.example .env
#    → .env を編集し、以下いずれかの方法でキーを設定:
```

### AI 認証の設定（いずれか 1 つ）

| 方法 | OS | 必要なもの |
|------|----|-----------|
| **A. Anthropic API Key** | Any | [Anthropic Console](https://console.anthropic.com/) のAPIキー |
| **B. `claude setup-token`** | Any | Claude Max/Pro サブスクリプション + Claude Code CLI |
| **C. `refresh-token.sh`** | macOS / Linux | Claude Code でログイン済み |

```bash
# .env に記入
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**B. `claude setup-token`** — Claude Max/Pro サブスクリプション利用:

```bash
# Claude Code CLI でトークンを発行（ブラウザが開く）
claude setup-token
# 表示されたトークンを .env に記入
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

**C. `refresh-token.sh`** — ローカルの Claude Code 認証情報を自動抽出:

```bash
# macOS: Keychain から / Linux: ~/.claude/.credentials.json から取得
./scripts/refresh-token.sh
```

---

```bash
# 3. Start all services
docker compose up --build
```

初回起動時に MovieLens データのダウンロード + DuckDB 構築 + dbt 変換が自動実行される（約1-2分）。
2回目以降はスキップされる。

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Cube.js Playground | http://localhost:4000 | セマンティックレイヤー API + Playground |
| Cube SQL API | localhost:15432 | PostgreSQL wire protocol (セマンティクス経由) |
| BI Dashboard | http://localhost:8080 | Chart.js ダッシュボード |
| AI Consultant | http://localhost:8787 | NL→SQL + データ分析 API |
| DuckDB Server | localhost:5433 | PostgreSQL wire protocol |
| Redash | http://localhost:5050 | BI ダッシュボード (クエリエディタ) |

### Redash セットアップ

`docker compose up` で Redash も一緒に起動する。初回のみセットアップが必要:

```bash
# 1. テーブル作成
docker compose exec redash python /app/manage.py database create_tables

# 2. ブラウザで http://localhost:5050 を開き、管理者アカウントを作成

# 3. Data Source を追加 (2つ):

#  ── (A) Cube SQL API (セマンティクスレイヤー経由・推奨) ──
#    Type: PostgreSQL
#    Name: Cube (Semantic Layer)
#    Host: cube
#    Port: 15432
#    User: cube
#    Password: cube-analytics-dev   ← CUBEJS_API_SECRET の値
#    Database Name: db

#  ── (B) DuckDB 直接接続 (セマンティクスなし) ──
#    Type: PostgreSQL
#    Name: DuckDB (Direct)
#    Host: duckdb-server
#    Port: 5433
#    User: (空)
#    Password: (空)
#    Database Name: (空)
```

## Chrome Extension

Chrome 拡張で Redash 上に NL→SQL / AI 分析 / DuckDB SQL パネルを表示する。

1. Chrome で `chrome://extensions` を開く
2. 「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `chrome-ext/` フォルダを選択
4. Redash (http://localhost:5050) を開くと右下に「Cube Tools」ボタンが表示される

### 3つのタブ

- **SQL変換** (紫): 自然言語 → Cube SQL 変換。「Redash に挿入」で ACE エディタにセット
- **AI分析** (緑): クエリ結果を Claude が分析。Thinking プロセスも確認可能
- **DuckDB SQL** (青): Cube.js が生成する実際の DuckDB SQL を確認

## API Examples

```bash
# Health check
curl http://localhost:8787/health

# NL → SQL
curl -X POST http://localhost:8787/nl2sql \
  -H "Content-Type: application/json" \
  -d '{"question": "ジャンル別の評価数トップ10"}'

# Cube meta
curl http://localhost:4000/cubejs-api/v1/meta
```

## Cube Models

| Cube | Source Table | Description |
|------|-------------|-------------|
| MovieStats | mart_movie_stats | 映画ごとの評価統計 |
| UserStats | mart_user_stats | ユーザーごとの評価統計 |
| GenreStats | mart_genre_stats | ジャンルごとの評価統計 |

## Local Development (without Docker)

```bash
# DuckDB + dbt
cd scripts && python3 load_movielens.py
cd ../dbt_project && dbt run --profiles-dir .

# Cube.js
cd cube && npm install && node index.js

# DuckDB Server
cd duckdb-server && pip install duckdb buenavista && python3 serve.py

# AI Consultant
cd ai-consultant && pip install -r requirements.txt
# API Key の場合:
ANTHROPIC_API_KEY=sk-ant-api03-... uvicorn server:app --host 127.0.0.1 --port 8787
# OAuth Token の場合:
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... uvicorn server:app --host 127.0.0.1 --port 8787
```

## Data

- **Source**: [MovieLens Latest Small](https://grouplens.org/datasets/movielens/latest/) (100k ratings, 9k movies, 600 users)
- **Pipeline**: CSV → DuckDB raw → dbt staging → dbt marts
- **Storage**: Single DuckDB file, opened read-only by Cube.js and DuckDB Server
