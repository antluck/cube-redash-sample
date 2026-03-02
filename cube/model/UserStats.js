cube('UserStats', {
  sql: `SELECT * FROM main_marts.mart_user_stats`,

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
    moviesRated: {
      sql: 'movies_rated',
      type: 'sum',
    },
  },

  dimensions: {
    userId: {
      sql: 'user_id',
      type: 'number',
      primaryKey: true,
    },
    avgRatingDim: {
      sql: 'avg_rating',
      type: 'number',
    },
    totalRatingsDim: {
      sql: 'total_ratings',
      type: 'number',
    },
    firstRatingAt: {
      sql: 'first_rating_at',
      type: 'time',
    },
    lastRatingAt: {
      sql: 'last_rating_at',
      type: 'time',
    },
  },
});
