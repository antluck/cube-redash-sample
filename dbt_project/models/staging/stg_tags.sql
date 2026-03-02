SELECT
    user_id,
    movie_id,
    tag,
    tagged_at
FROM raw.tags
WHERE tag IS NOT NULL
