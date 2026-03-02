#!/usr/bin/env python3
"""Load MovieLens ml-latest-small CSVs into DuckDB."""

import os

import duckdb
from pathlib import Path

_default_root = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("MOVIELENS_RAW_DIR", str(_default_root / "data" / "raw" / "ml-latest-small")))
DB_PATH = Path(os.environ.get("DUCKDB_PATH", str(_default_root / "data" / "analytics.duckdb")))


def main():
    con = duckdb.connect(str(DB_PATH))

    # Create raw schema
    con.execute("CREATE SCHEMA IF NOT EXISTS raw")

    # Load ratings
    con.execute(f"""
        CREATE OR REPLACE TABLE raw.ratings AS
        SELECT
            userId::INTEGER AS user_id,
            movieId::INTEGER AS movie_id,
            rating::DOUBLE AS rating,
            epoch_ms(timestamp * 1000) AS rated_at
        FROM read_csv_auto('{DATA_DIR}/ratings.csv')
    """)

    # Load movies
    con.execute(f"""
        CREATE OR REPLACE TABLE raw.movies AS
        SELECT
            movieId::INTEGER AS movie_id,
            title::VARCHAR AS title,
            genres::VARCHAR AS genres
        FROM read_csv_auto('{DATA_DIR}/movies.csv')
    """)

    # Load tags
    con.execute(f"""
        CREATE OR REPLACE TABLE raw.tags AS
        SELECT
            userId::INTEGER AS user_id,
            movieId::INTEGER AS movie_id,
            tag::VARCHAR AS tag,
            epoch_ms(timestamp * 1000) AS tagged_at
        FROM read_csv_auto('{DATA_DIR}/tags.csv')
    """)

    # Load links
    con.execute(f"""
        CREATE OR REPLACE TABLE raw.links AS
        SELECT
            movieId::INTEGER AS movie_id,
            imdbId::VARCHAR AS imdb_id,
            tmdbId::INTEGER AS tmdb_id
        FROM read_csv_auto('{DATA_DIR}/links.csv')
    """)

    # Print summary
    for table in ["ratings", "movies", "tags", "links"]:
        count = con.execute(f"SELECT COUNT(*) FROM raw.{table}").fetchone()[0]
        print(f"raw.{table}: {count:,} rows")

    con.close()
    print(f"\nDuckDB database created at: {DB_PATH}")


if __name__ == "__main__":
    main()
