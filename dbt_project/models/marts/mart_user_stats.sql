SELECT
    r.user_id,
    COUNT(*) AS total_ratings,
    ROUND(AVG(r.rating), 2) AS avg_rating,
    MIN(r.rating) AS min_rating,
    MAX(r.rating) AS max_rating,
    COUNT(DISTINCT r.movie_id) AS movies_rated,
    MIN(r.rated_at) AS first_rating_at,
    MAX(r.rated_at) AS last_rating_at
FROM {{ ref('stg_ratings') }} r
GROUP BY r.user_id
