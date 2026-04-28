const config = require('./config');
const { pool } = require('./src/db');
const { createApp } = require('./src/app');
const { initAuthDatabase } = require('./src/services/auth.service');
const { createApiRouteContext } = require('./src/context');
const registerApiRoutes = require('./src/routes');

const app = createApp();
registerApiRoutes(createApiRouteContext(app));

async function startServer() {
  try {
    await pool.query('SELECT 1');
    await initAuthDatabase();
    app.listen(config.PORT, '0.0.0.0', () => {
      console.log('Using data.gov.sg Traffic Images API');
      console.log(`Singapore Traffic Monitoring System started: http://localhost:${config.PORT}/`);
    });
  } catch (error) {
    console.error('❌ Startup failed, unable to connect PostgreSQL:', error.message);
    process.exit(1);
  }
}

startServer();
