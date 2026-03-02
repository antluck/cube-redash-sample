WITH genre_exploded AS (
    SELECT
        m.movie_id,
        UNNEST(string_split(m.genres, '|')) AS genre
    FROM {{ ref('stg_movies') }} m
    WHERE m.genres != '(no genres listed)'
)

SELECT
    g.genre,
    COUNT(DISTINCT g.movie_id) AS movie_count,
    COUNT(r.rating) AS total_ratings,
    ROUND(AVG(r.rating), 2) AS avg_rating,
    COUNT(DISTINCT r.user_id) AS unique_raters
FROM genre_exploded g
LEFT JOIN {{ ref('stg_ratings') }} r ON g.movie_id = r.movie_id
GROUP BY g.genre
