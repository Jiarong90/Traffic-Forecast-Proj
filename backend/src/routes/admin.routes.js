module.exports = function registerAdminFeedbackHabitRoutes(ctx) {
  const {
    app,
    pool,
    nowIso,
    requireAuth,
    requireAdmin,
    normalizeFeedbackPayload,
    validateFeedbackPayload,
    toPublicFeedbackRow,
    normalizeHabitRouteCoords,
    normalizeHabitRoutePayload,
    validateHabitRoutePayload,
    validateHabitRouteTimes,
    toPublicHabitRouteRow,
    isWithinAlertWindow,
    distancePointToPolylineMeters,
    buildHabitRouteAnalysis,
    fetchTrafficIncidentsRaw,
    deriveIncidentArea
  } = ctx;

app.get('/api/admin/users/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totalQ = await pool.query(`SELECT COUNT(*)::int AS total FROM app_user_profiles`);
    const verifiedQ = await pool.query(`SELECT COUNT(*)::int AS verified FROM auth.users WHERE deleted_at IS NULL AND email_confirmed_at IS NOT NULL`);
    const adminQ = await pool.query(`SELECT COUNT(*)::int AS admins FROM app_user_profiles WHERE role = 'admin'`);
    const userQ = await pool.query(`SELECT COUNT(*)::int AS normal_users FROM app_user_profiles WHERE role = 'user'`);
    const activeSessionQ = await pool.query(`SELECT COUNT(*)::int AS active_sessions FROM auth.sessions`);
    const new7dQ = await pool.query(`SELECT COUNT(*)::int AS new_7d FROM app_user_profiles WHERE created_at >= NOW() - INTERVAL '7 days'`);

    res.json({
      totalUsers: totalQ.rows[0].total,
      verifiedUsers: verifiedQ.rows[0].verified,
      adminUsers: adminQ.rows[0].admins,
      normalUsers: userQ.rows[0].normal_users,
      activeSessions: activeSessionQ.rows[0].active_sessions,
      newUsers7d: new7dQ.rows[0].new_7d
    });
  } catch (error) {
    console.error('Failed to load user statistics:', error.message);
    res.status(500).json({ error: 'Failed to load user statistics' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10) || 100, 500));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  try {
    const rows = await pool.query(
      `
      SELECT
        p.user_id AS id,
        p.name,
        p.email,
        p.role,
        (u.email_confirmed_at IS NOT NULL) AS email_verified,
        p.created_at
      FROM app_user_profiles p
      LEFT JOIN auth.users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM app_user_profiles`);
    res.json({ total: total.rows[0].total, limit, offset, value: rows.rows });
  } catch (error) {
    console.error('Failed to load user list:', error.message);
    res.status(500).json({ error: 'Failed to load user list' });
  }
});

app.post('/api/feedback', requireAuth, async (req, res) => {
  const feedback = normalizeFeedbackPayload(req.body || {});
  const error = validateFeedbackPayload(feedback);
  if (error) return res.status(400).json({ error });
  try {
    const inserted = await pool.query(
      `
      INSERT INTO app_user_feedback_reports (
        user_id, location, condition_type, severity, comment, latitude, longitude, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        user_id,
        $9::text AS user_name,
        $10::text AS user_email,
        location,
        condition_type,
        severity,
        comment,
        latitude,
        longitude,
        created_at
      `,
      [
        req.session.user.id,
        feedback.location,
        feedback.conditionType,
        feedback.severity,
        feedback.comment,
        feedback.latitude,
        feedback.longitude,
        nowIso(),
        req.session.user.name,
        req.session.user.email
      ]
    );
    res.json({ ok: true, item: toPublicFeedbackRow(inserted.rows[0]) });
  } catch (error) {
    console.error('Failed to submit feedback:', error.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

app.get('/api/feedback/mine', requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10) || 10, 20));
  try {
    const result = await pool.query(
      `
      SELECT
        f.id,
        f.user_id,
        u.name AS user_name,
        u.email AS user_email,
        f.location,
        f.condition_type,
        f.severity,
        f.comment,
        f.latitude,
        f.longitude,
        f.created_at
      FROM app_user_feedback_reports f
      JOIN app_user_profiles u ON u.user_id = f.user_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
      LIMIT $2
      `,
      [req.session.user.id, limit]
    );
    res.json({ value: result.rows.map(toPublicFeedbackRow) });
  } catch (error) {
    console.error('Failed to load user feedback:', error.message);
    res.status(500).json({ error: 'Failed to load user feedback' });
  }
});

app.get('/api/feedback/locations', requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '300', 10) || 300, 500));
  try {
    const result = await pool.query(
      `
      SELECT
        f.id,
        NULL::uuid AS user_id,
        NULL::text AS user_name,
        NULL::text AS user_email,
        f.location,
        f.condition_type,
        f.severity,
        f.comment,
        f.latitude,
        f.longitude,
        f.created_at
      FROM app_user_feedback_reports f
      WHERE f.latitude IS NOT NULL
        AND f.longitude IS NOT NULL
      ORDER BY f.created_at DESC
      LIMIT $1
      `,
      [limit]
    );
    res.json({ value: result.rows.map(toPublicFeedbackRow) });
  } catch (error) {
    console.error('Failed to load feedback locations:', error.message);
    res.status(500).json({ error: 'Failed to load feedback locations' });
  }
});

app.get('/api/admin/feedback', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '200', 10) || 200, 500));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  try {
    const rows = await pool.query(
      `
      SELECT
        f.id,
        f.user_id,
        u.name AS user_name,
        u.email AS user_email,
        f.location,
        f.condition_type,
        f.severity,
        f.comment,
        f.latitude,
        f.longitude,
        f.created_at
      FROM app_user_feedback_reports f
      JOIN app_user_profiles u ON u.user_id = f.user_id
      ORDER BY f.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM app_user_feedback_reports`);
    res.json({ total: total.rows[0].total, limit, offset, value: rows.rows.map(toPublicFeedbackRow) });
  } catch (error) {
    console.error('Failed to load admin feedback list:', error.message);
    res.status(500).json({ error: 'Failed to load admin feedback list' });
  }
});

app.delete('/api/admin/feedback/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid feedback id' });
  }
  try {
    const result = await pool.query(
      `
      DELETE FROM app_user_feedback_reports
      WHERE id = $1::bigint
      RETURNING id
      `,
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Feedback not found' });
    res.json({ ok: true, id: Number(result.rows[0].id) });
  } catch (error) {
    console.error('Failed to delete admin feedback:', error.message);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

app.get('/api/habit-routes', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM habit_routes
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.session.user.id]
    );
    res.json({ routes: result.rows.map(toPublicHabitRouteRow) });
  } catch (error) {
    console.error('Failed to load habit routes:', error.message);
    res.status(500).json({ error: 'Failed to load habit routes' });
  }
});

app.post('/api/habit-routes', requireAuth, async (req, res) => {
  const payload = normalizeHabitRoutePayload(req.body || {});
  const error = validateHabitRoutePayload(payload) || validateHabitRouteTimes(payload.alertStartTime, payload.alertEndTime);
  if (error) return res.status(400).json({ error });
  try {
    const inserted = await pool.query(
      `
      INSERT INTO habit_routes (
        user_id, route_name, from_label, to_label, coords_json, distance_m, link_ids,
        alert_enabled, alert_start_time, alert_end_time, created_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        req.session.user.id,
        payload.routeName,
        payload.fromLabel,
        payload.toLabel,
        JSON.stringify(payload.coords),
        payload.distanceM,
        JSON.stringify(payload.linkIds),
        payload.alertEnabled,
        payload.alertStartTime,
        payload.alertEndTime,
        nowIso()
      ]
    );
    res.json({ ok: true, route: toPublicHabitRouteRow(inserted.rows[0]) });
  } catch (error) {
    console.error('Failed to save habit route:', error.message);
    res.status(500).json({ error: 'Failed to save habit route' });
  }
});

app.patch('/api/habit-routes/:id', requireAuth, async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'Invalid route id' });
  const routeName = req.body?.route_name === undefined ? null : String(req.body.route_name || '').trim().slice(0, 120);
  const alertEnabled = req.body?.alert_enabled;
  const alertStartTime = req.body?.alert_start_time === undefined ? null : String(req.body.alert_start_time || '').trim().slice(0, 5);
  const alertEndTime = req.body?.alert_end_time === undefined ? null : String(req.body.alert_end_time || '').trim().slice(0, 5);
  if (routeName !== null && !routeName) return res.status(400).json({ error: 'Route name is required' });
  const timeError = (alertStartTime !== null || alertEndTime !== null)
    ? validateHabitRouteTimes(alertStartTime || '07:30', alertEndTime || '09:00')
    : null;
  if (timeError) return res.status(400).json({ error: timeError });

  try {
    const updated = await pool.query(
      `
      UPDATE habit_routes
      SET
        route_name = COALESCE($3, route_name),
        alert_enabled = COALESCE($4, alert_enabled),
        alert_start_time = COALESCE($5, alert_start_time),
        alert_end_time = COALESCE($6, alert_end_time)
      WHERE id = $1 AND user_id = $2
      RETURNING *
      `,
      [
        routeId,
        req.session.user.id,
        routeName,
        typeof alertEnabled === 'boolean' ? alertEnabled : null,
        alertStartTime,
        alertEndTime
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ error: 'Habit route not found' });
    res.json({ ok: true, route: toPublicHabitRouteRow(updated.rows[0]) });
  } catch (error) {
    console.error('Failed to update habit route:', error.message);
    res.status(500).json({ error: 'Failed to update habit route' });
  }
});

app.delete('/api/habit-routes/:id', requireAuth, async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'Invalid route id' });
  try {
    const result = await pool.query(
      `DELETE FROM habit_routes WHERE id = $1 AND user_id = $2 RETURNING id`,
      [routeId, req.session.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Habit route not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete habit route:', error.message);
    res.status(500).json({ error: 'Failed to delete habit route' });
  }
});

async function analyzeHabitRouteHandler(req, res) {
  const coords = normalizeHabitRouteCoords(req.body?.coords_json || req.body?.coords);
  if (coords.length < 2) return res.status(400).json({ error: 'Route coordinates are required' });
  try {
    const incidents = await fetchTrafficIncidentsRaw();
    res.json(buildHabitRouteAnalysis(coords, incidents));
  } catch (error) {
    console.error('Failed to analyze habit route:', error.message);
    res.status(500).json({ error: 'Failed to analyze habit route' });
  }
}

// app.post('/api/habit-routes/analyze', requireAuth, analyzeHabitRouteHandler);
// app.post('/api/ml/habit-routes/analyze', requireAuth, analyzeHabitRouteHandler);

app.get('/api/my-alerts', requireAuth, async (req, res) => {
  try {
    const [routesResult, incidents] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM habit_routes
        WHERE user_id = $1 AND alert_enabled = TRUE
        ORDER BY created_at DESC
        `,
        [req.session.user.id]
      ),
      fetchTrafficIncidentsRaw()
    ]);
    await pool.query(
      `
      UPDATE traffic_alerts
      SET is_dismissed = TRUE
      WHERE user_id = $1 AND expires_at <= NOW()
      `,
      [req.session.user.id]
    );

    const alerts = [];
    const now = new Date();
    for (const row of routesResult.rows) {
      const route = toPublicHabitRouteRow(row);
      if (!isWithinAlertWindow(route.alert_start_time, route.alert_end_time, now)) continue;
      for (const incident of incidents) {
        const distanceM = distancePointToPolylineMeters([Number(incident.lat), Number(incident.lon)], route.coords_json);
        if (!Number.isFinite(distanceM) || distanceM > 450) continue;
        const affectedLinkIds = Array.isArray(route.link_ids) ? route.link_ids.slice(0, 50) : [];
        const existing = await pool.query(
          `
          SELECT id, is_dismissed, created_at, expires_at
          FROM traffic_alerts
          WHERE user_id = $1
            AND route_id = $2
            AND affected_link_ids = $3::jsonb
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [req.session.user.id, route.id, JSON.stringify(affectedLinkIds)]
        );
        let alertId = existing.rows[0]?.id || null;
        let dismissed = Boolean(existing.rows[0]?.is_dismissed);
        if (!alertId) {
          const inserted = await pool.query(
            `
            INSERT INTO traffic_alerts (user_id, route_id, affected_link_ids, created_at, expires_at, is_dismissed)
            VALUES ($1, $2, $3::jsonb, $4, $5, FALSE)
            RETURNING id
            `,
            [req.session.user.id, route.id, JSON.stringify(affectedLinkIds), nowIso(), new Date(Date.now() + 15 * 60 * 1000).toISOString()]
          );
          alertId = inserted.rows[0]?.id || null;
        }
        if (dismissed) continue;
        alerts.push({
          id: alertId,
          route_id: route.id,
          route_name: route.route_name,
          incident_id: incident.id,
          message: incident.message,
          area: deriveIncidentArea(incident.message, incident.lat, incident.lon),
          distance_m: Math.round(distanceM),
          created_at: incident.createdAt
        });
      }
    }

    alerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(alerts);
  } catch (error) {
    console.error('Failed to load route alerts:', error.message);
    res.status(500).json({ error: 'Failed to load route alerts' });
  }
});

app.post('/api/my-alerts/dismiss', requireAuth, async (req, res) => {
  const routeId = Number(req.body?.routeId);
  const alertId = Number(req.body?.alertId);
  if (!Number.isFinite(routeId) || !Number.isFinite(alertId)) return res.status(400).json({ error: 'routeId and alertId are required' });
  try {
    const routeCheck = await pool.query(
      `SELECT id FROM habit_routes WHERE id = $1 AND user_id = $2`,
      [routeId, req.session.user.id]
    );
    if (!routeCheck.rows[0]) return res.status(404).json({ error: 'Habit route not found' });

    await pool.query(
      `
      UPDATE traffic_alerts
      SET is_dismissed = TRUE, expires_at = GREATEST(expires_at, $4)
      WHERE id = $1 AND user_id = $2 AND route_id = $3
      `,
      [alertId, req.session.user.id, routeId, nowIso()]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to dismiss route alert:', error.message);
    res.status(500).json({ error: 'Failed to dismiss route alert' });
  }
});
};
