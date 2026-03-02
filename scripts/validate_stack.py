#!/usr/bin/env python3
"""Validate the full DuckDB + dbt + Cube.dev stack."""

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "analytics.duckdb"
DBT_DIR = PROJECT_ROOT / "dbt_project"
CUBE_DIR = PROJECT_ROOT / "cube"

results = {"checks": [], "passed": 0, "failed": 0}


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    results["checks"].append({"name": name, "status": status, "detail": detail})
    if condition:
        results["passed"] += 1
    else:
        results["failed"] += 1
    print(f"  [{status}] {name}" + (f" - {detail}" if detail else ""))


def main():
    print("=== Phase 1: Data Foundation ===")

    # Check DuckDB file exists
    check("DuckDB file exists", DB_PATH.exists(), str(DB_PATH))

    # Check raw tables
    import duckdb
    con = duckdb.connect(str(DB_PATH), read_only=True)
    for table in ["ratings", "movies", "tags", "links"]:
        count = con.execute(f"SELECT COUNT(*) FROM raw.{table}").fetchone()[0]
        check(f"raw.{table} has data", count > 0, f"{count:,} rows")

    # Check dbt marts
    for table in ["mart_user_stats", "mart_movie_stats", "mart_genre_stats"]:
        try:
            count = con.execute(f"SELECT COUNT(*) FROM main_marts.{table}").fetchone()[0]
            check(f"marts.{table} has data", count > 0, f"{count:,} rows")
        except Exception as e:
            check(f"marts.{table} has data", False, str(e))
    con.close()

    print("\n=== Phase 2: Cube.dev Semantic Layer ===")

    # Check Cube.js files
    check("Cube index.js exists", (CUBE_DIR / "index.js").exists())
    check("Cube .env exists", (CUBE_DIR / ".env").exists())
    model_files = list((CUBE_DIR / "model").glob("*.js"))
    check("Cube model files exist", len(model_files) >= 3, f"{len(model_files)} files")

    # Start Cube.js server
    proc = subprocess.Popen(
        ["node", "index.js"],
        cwd=str(CUBE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    time.sleep(10)

    # Test meta endpoint
    try:
        req = urllib.request.Request(
            "http://localhost:4000/cubejs-api/v1/meta",
            headers={"Authorization": "cube-movielens-dev-secret"},
        )
        resp = urllib.request.urlopen(req, timeout=10)
        meta = json.loads(resp.read())
        cube_names = [c["name"] for c in meta.get("cubes", [])]
        check("Cube meta endpoint works", len(cube_names) >= 3, str(cube_names))
    except Exception as e:
        check("Cube meta endpoint works", False, str(e))

    # Test query endpoint
    try:
        query = json.dumps({
            "measures": ["GenreStats.count"],
            "dimensions": ["GenreStats.genre", "GenreStats.avgRating"],
            "order": {"GenreStats.avgRating": "desc"},
            "limit": 5,
        })
        url = f"http://localhost:4000/cubejs-api/v1/load?query={urllib.parse.quote(query)}"
        req = urllib.request.Request(url, headers={"Authorization": "cube-movielens-dev-secret"})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        rows = data.get("data", [])
        check("Cube query returns data", len(rows) > 0, f"{len(rows)} rows returned")
        if rows:
            top = rows[0]
            check(
                "Top genre data valid",
                "GenreStats.genre" in top and "GenreStats.avgRating" in top,
                f"Top: {top.get('GenreStats.genre')} avg={top.get('GenreStats.avgRating')}",
            )
    except Exception as e:
        check("Cube query returns data", False, str(e))

    # Cleanup
    proc.terminate()
    proc.wait(timeout=5)

    print(f"\n=== Results: {results['passed']}/{results['passed']+results['failed']} passed ===")
    return results


if __name__ == "__main__":
    import urllib.parse
    r = main()
    sys.exit(0 if r["failed"] == 0 else 1)
