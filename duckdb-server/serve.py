#!/usr/bin/env python3
"""DuckDB PostgreSQL wire server using Buena Vista.

Opens the analytics DuckDB file in read_only mode and exposes it
via PostgreSQL wire protocol on port 5433. Allows Redash (or any
PostgreSQL client) to query DuckDB directly without ATTACH.

Usage:
    python3 serve.py                  # default: analytics.duckdb, port 5433
    python3 serve.py --port 5434      # custom port
    python3 serve.py --db /path/to.db # custom database file
"""

import argparse
import os

import duckdb
from buenavista.backends.duckdb import DuckDBConnection
from buenavista.postgres import BuenaVistaServer


def main():
    parser = argparse.ArgumentParser(description="DuckDB PostgreSQL wire server")
    parser.add_argument(
        "--db",
        default=os.environ.get(
            "DUCKDB_PATH",
            os.path.join(os.path.dirname(__file__), "..", "data", "analytics.duckdb"),
        ),
        help="Path to DuckDB database file",
    )
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5433")))
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    print(f"Opening DuckDB: {db_path} (read_only)")
    conn = duckdb.connect(db_path, read_only=True)

    # Verify tables are accessible
    tables = conn.execute(
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_schema NOT IN ('information_schema', 'pg_catalog')"
    ).fetchall()
    print(f"Tables: {len(tables)}")
    for schema, table in tables:
        print(f"  {schema}.{table}")

    bv_conn = DuckDBConnection(conn)

    print(f"\nListening on {args.host}:{args.port} (PostgreSQL wire protocol)")
    print(f"Connect: psql -h {args.host} -p {args.port}")

    server = BuenaVistaServer((args.host, args.port), bv_conn)
    server.serve_forever()


if __name__ == "__main__":
    main()
