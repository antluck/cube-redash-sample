cube('GenreStats', {
  sql: `SELECT * FROM main_marts.mart_genre_stats`,

  measures: {
    count: {
      type: 'count',
    },
    totalRatings: {
      sql: 'total_ratings',
      type: 'sum',
    },
    movieCount: {
      sql: 'movie_count',
      type: 'sum',
    },
    uniqueRaters: {
      sql: 'unique_raters',
      type: 'sum',
    },
  },

  dimensions: {
    genre: {
      sql: 'genre',
      type: 'string',
      primaryKey: true,
    },
    avgRating: {
      sql: 'avg_rating',
      type: 'number',
    },
  },
});
