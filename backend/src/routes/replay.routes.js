const crypto = require('crypto');

const activeReplayRecordings = new Map();

function normalizeReplayRouteName(value) {
  const name = String(value || '').trim().slice(0, 120);
  return name || 'Unnamed route';
}

function normalizeReplayLinkIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, 500);
}

function makeRecordingId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `rec_${stamp}_${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = function registerReplayRoutes(ctx) {
  const {
    app,
    nowIso,
    requireAuth,
    requireAdmin
  } = ctx;

  app.post('/api/replay/start', requireAuth, requireAdmin, async (req, res) => {
    const routeName = normalizeReplayRouteName(req.body?.route_name || req.body?.routeName);
    const linkIds = normalizeReplayLinkIds(req.body?.link_ids || req.body?.linkIds);
    if (!linkIds.length) {
      return res.status(400).json({ error: 'Route link ids are required to start replay recording' });
    }

    const recordingId = makeRecordingId();
    const item = {
      recording_id: recordingId,
      route_id: req.body?.route_id || req.body?.routeId || null,
      route_name: routeName,
      link_ids: linkIds,
      started_at: nowIso(),
      stopped_at: null,
      status: 'recording',
      snapshots: []
    };
    activeReplayRecordings.set(recordingId, item);

    return res.json({
      ok: true,
      recording_id: recordingId,
      route_name: routeName,
      status: item.status
    });
  });

  app.post('/api/replay/stop', requireAuth, requireAdmin, async (req, res) => {
    const recordingId = String(req.body?.recording_id || req.body?.recordingId || '').trim();
    const routeName = normalizeReplayRouteName(req.body?.route_name || req.body?.routeName);

    let targetId = recordingId;
    if (!targetId) {
      for (const [id, item] of activeReplayRecordings.entries()) {
        if (item.route_name === routeName && item.status === 'recording') {
          targetId = id;
          break;
        }
      }
    }

    if (!targetId || !activeReplayRecordings.has(targetId)) {
      return res.status(404).json({ error: 'Active replay recording not found' });
    }

    const item = activeReplayRecordings.get(targetId);
    item.status = 'stopped';
    item.stopped_at = nowIso();
    activeReplayRecordings.set(targetId, item);

    return res.json({
      ok: true,
      recording_id: item.recording_id,
      route_name: item.route_name,
      status: item.status,
      message: `Recording stopped for ${item.route_name}`
    });
  });
};
