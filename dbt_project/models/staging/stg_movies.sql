SELECT
    movie_id,
    title,
    -- Extract year from title like "Toy Story (1995)"
    CASE
        WHEN regexp_extract(title, '\((\d{4})\)\s*$', 1) != ''
        THEN regexp_extract(title, '\((\d{4})\)\s*$', 1)::INTEGER
    END AS release_year,
    -- Keep raw genres for downstream exploding
    genres
FROM raw.movies
