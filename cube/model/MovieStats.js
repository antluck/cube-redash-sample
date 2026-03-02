cube('MovieStats', {
  sql: `SELECT * FROM main_marts.mart_movie_stats`,

  measures: {
    count: {
      type: 'count',
    },
    avgRating: {
      sql: 'avg_rating',
      type: 'avg',
    },
    totalRatings: {
      sql: 'total_ratings',
      type: 'sum',
    },
    uniqueRaters: {
      sql: 'unique_raters',
      type: 'sum',
    },
  },

  dimensions: {
    movieId: {
      sql: 'movie_id',
      type: 'number',
      primaryKey: true,
    },
    title: {
      sql: 'title',
      type: 'string',
    },
    releaseYear: {
      sql: 'release_year',
      type: 'number',
    },
    genres: {
      sql: 'genres',
      type: 'string',
    },
    avgRatingDim: {
      sql: 'avg_rating',
      type: 'number',
    },
  },
});
