const CubejsServer = require('@cubejs-backend/server');

const server = new CubejsServer({
  orchestratorOptions: {
    queryCacheOptions: { refreshKeyRenewalThreshold: 0 },
  },
  allowUngroupedWithoutPrimaryKey: true,
  dbType: 'duckdb',
  driverFactory: () => {
    const { DuckDBDriver } = require('@cubejs-backend/duckdb-driver');
    const duckdb = require('duckdb');

    const DB_PATH = process.env.CUBEJS_DB_DUCKDB_DATABASE_PATH || ':memory:';
    const driver = new DuckDBDriver({});

    // Override init to open DuckDB in read_only mode (allows concurrent readers)
    driver.init = async function () {
      const db = await new Promise((resolve, reject) => {
        const instance = new duckdb.Database(DB_PATH, { access_mode: 'read_only' }, (err) => {
          if (err) reject(err);
          else resolve(instance);
        });
      });
      const defaultConnection = db.connect();
      return { defaultConnection, db };
    };

    return driver;
  },
});

server.listen().then(({ version, port }) => {
  console.log(`Cube.js server (${version}) is listening on ${port} [DuckDB read_only]`);
}).catch(e => {
  console.error('Cube.js start error:', e);
  process.exit(1);
});
