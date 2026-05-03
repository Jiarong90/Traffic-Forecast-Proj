module.exports = function registerPublicTrafficRoutes(ctx) {
  const {
    app,
    latestMobileLocation,
    realtimeCameraFallback,
    NEWS_ACCIDENT_RSS,
    NEWS_RULE_RSS,
    ONEMOTORING_ERP_KML_URL,
    ONEMOTORING_PGS_KML_URL,
    nowIso,
    trimText,
    getMobileLocationPayload,
    withCache,
    fetchRss,
    fetchTrafficImageCameras,
    loadLtaSignalGeoJsonCameras,
    fetchSpfRedLightCameras,
    fetchOsmCameraLocations,
    fetchMockIncidentsWithResolution,
    fetchTrafficIncidentsRaw,
    attachNearestRealtimeCamera,
    parseErpKml,
    fetchTextCached,
    fetchLocalErpRates,
    parsePgsKml,
    fetchParkingRatesLookup,
    findBestParkingRateMatch
  } = ctx;

  // 代理交通摄像头接口（避免跨域）
  app.get('/api/traffic-images', async (req, res) => {
    try {
      const cameras = await fetchTrafficImageCameras();
      res.json({ value: cameras });
    } catch (error) {
      console.error('Failed to load traffic camera data:', error.message);
      res.status(500).json({ error: 'Failed to load camera data', details: error.message });
    }
  });

  // 聚合多源摄像头数据（含无实时图片点位）
  app.get('/api/cameras', async (req, res) => {
    const tasks = [
      ['dataGovTrafficImages', fetchTrafficImageCameras()],
      ['ltaSignalGeoJson', loadLtaSignalGeoJsonCameras()],
      ['spfRedLightCameras', fetchSpfRedLightCameras()],
      ['osmCameraNodes', fetchOsmCameraLocations()]
    ];
    const settled = await Promise.allSettled(tasks.map(([, p]) => p));

    const value = [];
    const warnings = [];
    settled.forEach((result, idx) => {
      const sourceName = tasks[idx][0];
      if (result.status === 'fulfilled') {
        value.push(...result.value);
      } else {
        warnings.push({
          source: sourceName,
          error: result.reason?.message || String(result.reason)
        });
      }
    });

    const realtimeOnly = String(req.query.realtimeOnly || '').toLowerCase();
    const max = Math.max(1, Math.min(parseInt(req.query.max || '10000', 10) || 10000, 10000));
    let filtered = value;
    if (realtimeOnly === '1' || realtimeOnly === 'true') {
      filtered = filtered.filter(v => v.HasRealtimeImage && v.ImageLink);
    }
    filtered = filtered.slice(0, max);

    res.json({
      value: filtered,
      meta: {
        total: filtered.length,
        realtimeWithImage: filtered.filter(v => v.HasRealtimeImage && v.ImageLink).length,
        locationOnly: filtered.filter(v => !v.HasRealtimeImage).length,
        warnings,
        generatedAt: new Date().toISOString()
      }
    });
  });

  app.get('/api/incidents', async (req, res) => {
    try {
      const source = String(req.query.source || 'live').toLowerCase();
      if (source === 'mock') {
        const mock = await fetchMockIncidentsWithResolution();
        const [cameraResult] = await Promise.allSettled([fetchTrafficImageCameras()]);
        const cameras = cameraResult.status === 'fulfilled'
          ? (cameraResult.value || [])
          : (realtimeCameraFallback.value || []);
        const withCameras = await attachNearestRealtimeCamera(mock.value, cameras);
        const withImagesOnly = String(req.query.withImagesOnly || '0').toLowerCase();
        const max = Math.max(1, Math.min(parseInt(req.query.max || '30', 10) || 30, 100));
        const filtered = (withImagesOnly === '1' || withImagesOnly === 'true')
          ? withCameras.filter(i => i.imageLink)
          : withCameras;
        return res.json({
          value: filtered.slice(0, max),
          meta: {
            ...mock.meta,
            total: filtered.length,
            generatedAt: nowIso()
          }
        });
      }

      const [incidentsResult, camerasResult] = await Promise.allSettled([
        fetchTrafficIncidentsRaw(),
        fetchTrafficImageCameras()
      ]);
      if (incidentsResult.status !== 'fulfilled') {
        throw new Error(incidentsResult.reason?.message || 'Incident data source unavailable');
      }
      const incidents = incidentsResult.value || [];
      const cameras = camerasResult.status === 'fulfilled'
        ? (camerasResult.value || [])
        : (realtimeCameraFallback.value || []);
      const warnings = [];
      if (camerasResult.status !== 'fulfilled') {
        warnings.push({
          source: 'dataGovTrafficImages',
          fallback: realtimeCameraFallback.value?.length ? 'stale-cache' : 'no-camera-data',
          error: camerasResult.reason?.message || 'Camera source unavailable'
        });
      }

      const withCameras = await attachNearestRealtimeCamera(incidents, cameras);
      const withImagesOnly = String(req.query.withImagesOnly || '0').toLowerCase();
      const max = Math.max(1, Math.min(parseInt(req.query.max || '30', 10) || 30, 100));
      const filtered = (withImagesOnly === '1' || withImagesOnly === 'true')
        ? withCameras.filter(i => i.imageLink)
        : withCameras;

      res.json({
        value: filtered.slice(0, max),
        meta: {
          source: 'live',
          total: filtered.length,
          cameraFallbackCount: camerasResult.status === 'fulfilled' ? 0 : (realtimeCameraFallback.value?.length || 0),
          warnings,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Failed to load live incidents:', error.message);
      res.status(500).json({ error: 'Failed to load live incidents', details: error.message });
    }
  });

  function parseFeedDate(raw) {
    if (!raw) return null;

    const text = String(raw).trim();

    // Split "03/05/2026, 5:00:00 am"
    const parts = text.split(",");
    const datePart = parts[0]?.trim();
    const timePart = parts[1]?.trim() || "00:00:00";

    // If it is DD/MM/YYYY, parse manually
    if (datePart && datePart.includes("/")) {
      const dateBits = datePart.split("/").map(Number);

      if (dateBits.length === 3) {
        const [day, month, year] = dateBits;

        if (day && month && year) {
          const timeBits = timePart.split(" ");
          const clockPart = timeBits[0] || "00:00:00";
          const ampm = (timeBits[1] || "").toLowerCase();

          const clockBits = clockPart.split(":").map(Number);
          let hour = clockBits[0] || 0;
          const minute = clockBits[1] || 0;
          const second = clockBits[2] || 0;

          if (ampm === "pm" && hour < 12) hour += 12;
          if (ampm === "am" && hour === 12) hour = 0;

          return new Date(year, month - 1, day, hour, minute, second);
        }
      }
    }

    // fallback for normal RSS dates like "Sun, 03 May 2026 05:00:00 GMT"
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  function feedDateMs(raw) {
    const date = parseFeedDate(raw);
    return date ? date.getTime() : NaN;
  }


  // Alerts 右侧资讯流：近 7 天事故新闻 + 最新交通规则更新
  app.get('/api/traffic-info-feed', async (req, res) => {
    try {
      /**
       * 新闻专栏数据聚合（Alerts 右栏）
       *
       * “交通相关”判断方式：
       * - 不是对全文做机器学习分类，而是通过 RSS 查询词先做主题过滤
       *   NEWS_ACCIDENT_RSS: Singapore traffic accident when:7d
       *   NEWS_RULE_RSS:     Singapore LTA traffic rule update
       *
       * “最近一周”判断方式：
       * - 对每条新闻 publishedAt 转时间戳
       * - 满足 ts >= now-7天 且 ts <= now+10分钟（容忍源站时区微偏差）
       *
       * 返回结构：
       * - weeklyNews: 最近7天事故新闻（最多20条，按时间倒序）
       * - latestRule: 最新一条规则更新新闻
       * - warnings:   某一上游源失败时的告警信息
       */
      const feed = await withCache('traffic-info-feed', 15 * 60 * 1000, async () => {
        const nowMs = Date.now();
        const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
        const settled = await Promise.allSettled([
          fetchRss(NEWS_ACCIDENT_RSS),
          fetchRss(NEWS_RULE_RSS)
        ]);

        const warnings = [];
        const accidentItems = settled[0].status === 'fulfilled' ? settled[0].value : [];
        const ruleItems = settled[1].status === 'fulfilled' ? settled[1].value : [];
        if (settled[0].status !== 'fulfilled') {
          warnings.push({ source: 'weeklyNews', error: settled[0].reason?.message || 'Incident news source unavailable' });
        }
        if (settled[1].status !== 'fulfilled') {
          warnings.push({ source: 'latestRule', error: settled[1].reason?.message || 'Rules news source unavailable' });
        }

        const weeklyNews = (accidentItems || [])
          .filter((it) => {
            const ts = feedDateMs(it.publishedAt);
            return Number.isFinite(ts) && ts >= weekAgoMs && ts <= nowMs + 10 * 60 * 1000;
          })
          .sort((a, b) => feedDateMs(b.publishedAt) - feedDateMs(a.publishedAt))
          .slice(0, 20);

        const latestRule = (ruleItems || [])
          .filter((it) => Number.isFinite(feedDateMs(it.publishedAt)))
          .sort((a, b) => feedDateMs(b.publishedAt) - feedDateMs(a.publishedAt))[0] || null;

        return {
          weeklyNews,
          latestRule,
          generatedAt: nowIso(),
          warnings
        };
      });
      res.json(feed);
    } catch (error) {
      console.error('Failed to load traffic info feed:', error.message);
      res.status(500).json({
        weeklyNews: [],
        latestRule: null,
        generatedAt: nowIso(),
        warnings: [{ source: 'feed', error: error.message || 'Traffic info feed fetch failed' }]
      });
    }
  });

  // 地点转坐标（支持邮编或地名；优先 OneMap，邮编时补充 postcode.dabase.com）
  app.get('/api/geocode', async (req, res) => {
    /**
     * 地理编码入口（起点/终点文本 -> 坐标）
     *
     * 设计目标：
     * - 同时支持邮编、地名、MRT 站名
     * - 与天气模块统一 OneMap 优先策略
     *
     * 数据源优先顺序：
     * 1) OneMap（主源）
     * 2) postcode.dabase.com（仅邮编）
     * 3) Nominatim（兜底）
     */
    const query = (req.query.q || req.query.location || req.query.postal || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'Please enter start/destination (postal code or place)' });
    }
    const isPostal = /^\d{6}$/.test(query);
    const maybeMrt = /mrt|station/i.test(query);

    function pickBestOneMapResult(results, originalQuery) {
      if (!Array.isArray(results) || !results.length) return null;
      const q = String(originalQuery || '').toLowerCase();
      const scored = results.map((r, idx) => {
        const building = String(r.BUILDING || '').toLowerCase();
        const address = String(r.ADDRESS || '').toLowerCase();
        const searchVal = String(r.SEARCHVAL || '').toLowerCase();
        let score = 0;
        if (q && (building.includes(q) || address.includes(q) || searchVal.includes(q))) score += 3;
        if (building.includes('mrt') || building.includes('station') || searchVal.includes('mrt') || searchVal.includes('station')) score += 4;
        if (address.includes('mrt')) score += 2;
        return { r, idx, score };
      });
      scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
      return scored[0]?.r || null;
    }

    async function oneMapLookup(searchVal) {
      const r = await fetch(`https://developers.onemap.sg/commonapi/search?searchVal=${encodeURIComponent(searchVal)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`);
      if (!r.ok) return null;
      const d = await r.json();
      const best = pickBestOneMapResult(d?.results || [], query);
      if (!best) return null;
      return {
        lat: parseFloat(best.LATITUDE || best.latitude),
        lon: parseFloat(best.LONGITUDE || best.longitude),
        display: best.ADDRESS || best.BUILDING || best.SEARCHVAL || searchVal,
        postal: best.POSTAL || '',
        building: best.BUILDING || ''
      };
    }

    const sources = [
      // 1) OneMap 搜索（与天气模块一致，支持地名和邮编）
      async () => {
        const candidates = [query];
        if (!isPostal && !maybeMrt) {
          candidates.push(`${query} MRT`, `${query} MRT Station`);
        }
        for (const c of candidates) {
          const found = await oneMapLookup(c);
          if (found) return found;
        }
        return null;
      },
      // 2) postcode.dabase.com（仅处理邮编）
      async () => {
        if (!isPostal) return null;
        const r = await fetch(`https://postcode.dabase.com/?postcode=${query}`);
        if (!r.ok) return null;
        const geo = await r.json();
        if (geo?.geometry?.coordinates) {
          const [lon, lat] = geo.geometry.coordinates;
          return { lat, lon, display: geo.properties?.Place || query, postal: query };
        }
        return null;
      },
      // 3) Nominatim 兜底
      async () => {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' Singapore')}&format=json&limit=1`,
          { headers: { 'User-Agent': 'SingaporeTrafficApp/1.0 (Route Planner)' } }
        );
        const d = await r.json();
        if (d?.length > 0) {
          const x = d[0];
          return { lat: parseFloat(x.lat), lon: parseFloat(x.lon), display: x.display_name };
        }
        return null;
      }
    ];

    for (const fn of sources) {
      try {
        const result = await fn();
        if (result) return res.json(result);
      } catch (e) {
        continue;
      }
    }
    res.status(404).json({ error: `Location \"${query}\" not found, try postal code or a more complete place name` });
  });

  app.get('/api/reverse-geocode', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'Invalid lat/lon parameters' });
    }
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=jsonv2&addressdetails=1`,
        { headers: { 'User-Agent': 'SingaporeTrafficApp/1.0 (Reverse Geocode)' } }
      );
      if (!r.ok) throw new Error(`Reverse geocode API error: ${r.status}`);
      const d = await r.json();
      const address = d?.address || {};
      const name =
        d?.name ||
        address.amenity ||
        address.building ||
        address.road ||
        address.suburb ||
        address.neighbourhood ||
        d?.display_name ||
        'Current Location';
      return res.json({
        lat,
        lon,
        display: name,
        postal: address.postcode || '',
        address: d?.display_name || name
      });
    } catch (e) {
      return res.status(500).json({ error: 'Reverse geocode failed', details: e.message });
    }
  });

  app.get('/api/onemotoring/erp', async (req, res) => {
    try {
      const [kmlText, localRates] = await Promise.all([
        fetchTextCached(ONEMOTORING_ERP_KML_URL),
        fetchLocalErpRates().catch(() => ({ gantries: {} }))
      ]);
      const items = parseErpKml(kmlText);
      const enriched = items.map((item) => {
        const gantryNoMatch = String(item.name || '').match(/\((\d+)\)\s*$/);
        const gantryNo = gantryNoMatch ? gantryNoMatch[1] : '';
        const localBands = gantryNo ? (localRates?.gantries?.[gantryNo] || []) : [];
        return {
          ...item,
          gantryNo,
          localRates: Array.isArray(localBands) ? localBands : []
        };
      });
      res.json({
        value: enriched,
        meta: {
          total: enriched.length,
          source: 'OneMotoring traffic.smart ERP KML',
          sourceUrl: ONEMOTORING_ERP_KML_URL,
          generatedAt: nowIso()
        }
      });
    } catch (error) {
      console.error('Failed to load OneMotoring ERP markers:', error.message);
      res.status(500).json({ error: 'Failed to load ERP markers' });
    }
  });

  app.get('/api/onemotoring/pgs', async (req, res) => {
    try {
      const [kmlText, parkingRates] = await Promise.all([
        fetchTextCached(ONEMOTORING_PGS_KML_URL),
        fetchParkingRatesLookup()
      ]);
      const items = parsePgsKml(kmlText).map((item) => {
        const matchedRate = findBestParkingRateMatch(item.name, parkingRates);
        return {
          ...item,
          rates: matchedRate ? {
            name: matchedRate.name,
            weekdayBefore: matchedRate.weekdayBefore,
            weekdayAfter: matchedRate.weekdayAfter,
            saturday: matchedRate.saturday,
            sunday: matchedRate.sunday,
            sourceUrl: matchedRate.sourceUrl
          } : null
        };
      });
      res.json({
        value: items,
        meta: {
          total: items.length,
          source: 'OneMotoring traffic.smart PGS KML + official parking rates pages',
          sourceUrl: ONEMOTORING_PGS_KML_URL,
          generatedAt: nowIso()
        }
      });
    } catch (error) {
      console.error('Failed to load OneMotoring PGS markers:', error.message);
      res.status(500).json({ error: 'Failed to load PGS markers' });
    }
  });

  app.get('/api/mobile-location/latest', (req, res) => {
    res.json(getMobileLocationPayload());
  });

  app.post('/api/mobile-location/update', (req, res) => {
    const lat = parseFloat(req.body?.lat);
    const lon = parseFloat(req.body?.lon);
    const accuracy = parseFloat(req.body?.accuracy);
    const deviceName = trimText(req.body?.deviceName || 'Android device', 80);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'Invalid lat/lon' });
    }
    latestMobileLocation.lat = lat;
    latestMobileLocation.lon = lon;
    latestMobileLocation.accuracy = Number.isFinite(accuracy) ? accuracy : null;
    latestMobileLocation.timestamp = Date.now();
    latestMobileLocation.source = 'mobile';
    latestMobileLocation.deviceName = deviceName;
    return res.json({ ok: true, value: getMobileLocationPayload() });
  });

  app.post('/api/mobile-location/clear', (req, res) => {
    latestMobileLocation.lat = null;
    latestMobileLocation.lon = null;
    latestMobileLocation.accuracy = null;
    latestMobileLocation.timestamp = null;
    latestMobileLocation.source = 'none';
    latestMobileLocation.deviceName = '';
    return res.json({ ok: true });
  });
};
