module.exports = function registerLegacyComputeRoutes(ctx) {
  const {
    app,
    pool,
    nowIso,
    requireAuth,
    callFastApiJson,
    runPythonCompute
  } = ctx;

  app.post('/api/recalculate', requireAuth, async (req, res) => {
    try {
      const payload = req.body || {};
      try {
        const result = await callFastApiJson('/api/recalculate', payload, 20000);
        return res.json(result);
      } catch (fastApiErr) {
        console.warn(`FastAPI recalculate fell back to python script: ${fastApiErr.message}`);
        const result = await runPythonCompute('recalculate_route', payload, 20000);
        return res.json(result);
      }
    } catch (error) {
      console.error('Recalculation failed:', error.message);
      res.status(500).json({ error: 'Engine failed to reroute' });
    }
  });

  async function listIncidentFeedback(req, res) {
    try {
      const location = String(req.body?.location || '').trim();
      const params = [];
      let where = '';
      if (location) {
        params.push(location);
        where = `WHERE f.location = $${params.length}`;
      }
      params.push(10);
      const result = await pool.query(
        `
        SELECT
          f.id,
          f.user_id,
          f.location,
          f.condition_type,
          f.severity,
          f.comment,
          f.latitude,
          f.longitude,
          f.created_at
        FROM app_user_feedback_reports f
        ${where}
        ORDER BY f.created_at DESC
        LIMIT $${params.length}
        `,
        params
      );
      res.json({ reports: result.rows });
    } catch (error) {
      console.error('Failed to load feedback:', error.message);
      res.status(500).json({ error: 'Failed to load feedback' });
    }
  }

  async function saveIncidentFeedback(req, res) {
    try {
      const body = req.body || {};
      const location = String(body.location || '').trim();
      const comment = String(body.comment || '').trim();
      const conditionType = String(body.condition_type || body.conditionType || 'UPDATE').trim().toUpperCase();
      const severity = String(body.severity || 'MEDIUM').trim().toUpperCase();
      const lat = Number.isFinite(Number(body.lat ?? body.latitude)) ? Number(body.lat ?? body.latitude) : null;
      const lon = Number.isFinite(Number(body.lon ?? body.longitude)) ? Number(body.lon ?? body.longitude) : null;

      if (!location) return res.status(400).json({ error: 'Location is required' });
      if (!comment) return res.status(400).json({ error: 'Comment is required' });

      const inserted = await pool.query(
        `
        INSERT INTO app_user_feedback_reports (
          user_id, location, condition_type, severity, comment, latitude, longitude, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING
          id,
          user_id,
          location,
          condition_type,
          severity,
          comment,
          latitude,
          longitude,
          created_at
        `,
        [req.session.user.id, location, conditionType, severity, comment, lat, lon, nowIso()]
      );
      res.json({ ok: true, item: inserted.rows[0] });
    } catch (error) {
      console.error('Failed to save feedback:', error.message);
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  }

  app.post('/api/feedback/list', requireAuth, listIncidentFeedback);
  app.post('/api/ml/feedback/list', requireAuth, listIncidentFeedback);
  app.post('/api/feedback/save', requireAuth, saveIncidentFeedback);
  app.post('/api/ml/feedback/save', requireAuth, saveIncidentFeedback);

  app.post('/api/ml/incident-predict', requireAuth, async (req, res) => {
    try {
      const { type, message, hour, day_of_week, lat, lon } = req.body || {};
      const now = new Date();
      const numericHour = Number(hour);
      const numericDow = Number(day_of_week);
      const payload = {
        type: String(type || 'Accident'),
        message: String(message || ''),
        hour: Number.isFinite(numericHour) ? numericHour : now.getHours(),
        day_of_week: Number.isFinite(numericDow) ? numericDow : (now.getDay() === 0 ? 6 : now.getDay() - 1),
        lat,
        lon
      };

      try {
        const pyResult = await callFastApiJson('/api/ml/incident-predict', payload, 15000);
        return res.json(pyResult);
      } catch (fastApiErr) {
        console.warn(`FastAPI incident predict fell back to python script: ${fastApiErr.message}`);
        const pyResult = await runPythonCompute('incident_predict', payload, 15000);
        return res.json(pyResult);
      }
    } catch (e) {
      console.error('Incident ML prediction failure:', e.message);
      res.status(500).json({
        error: 'Incident ML prediction failed',
        details: e.message
      });
    }
  });
};
