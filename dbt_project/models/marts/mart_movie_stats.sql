SELECT
    m.movie_id,
    m.title,
    m.release_year,
    m.genres,
    COUNT(r.rating) AS total_ratings,
    ROUND(AVG(r.rating), 2) AS avg_rating,
    ROUND(STDDEV(r.rating), 2) AS stddev_rating,
    COUNT(DISTINCT r.user_id) AS unique_raters
FROM {{ ref('stg_movies') }} m
LEFT JOIN {{ ref('stg_ratings') }} r ON m.movie_id = r.movie_id
GROUP BY m.movie_id, m.title, m.release_year, m.genres
