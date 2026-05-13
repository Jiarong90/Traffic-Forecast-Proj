// Shared runtime state and map constants.

// ================= 摄像头 + 路径规划整合模块 =================
// 新加坡地图默认中心点
const SG_CENTER = [1.3521, 103.8198];
const ROUTE_COLORS = {
  fastest: "#2563eb",
  fewerLights: "#16a34a",
  balanced: "#ea580c"
};
const ROUTE_LABELS = {
  fastest: "FASTEST",
  fewerLights: "FEWER LIGHTS",
  balanced: "BALANCED"
};
const ROUTE_PREFERENCE_ORDER = ["fastest", "fewerLights", "balanced"];
const ROUTE_PREFERENCE_TEXT = {
  fastest: "FASTEST ROUTE",
  fewerLights: "FEWER LIGHTS",
  balanced: "BALANCED"
};
const MAP_POI_ICON_URLS = {
  camera: "/assets/images/CAMERA.jpg",
  incident: "/assets/images/INCIDENTS.jpg",
  erp: "/assets/images/ERP.jpg",
  pgs: "/assets/images/PGS.jpg"
};

function getMapPoiIcon(type) {
  const iconUrl = MAP_POI_ICON_URLS[type] || MAP_POI_ICON_URLS.camera;
  const iconSize = type === "erp" || type === "pgs" ? [24, 12] : [15, 15];
  return L.icon({
    iconUrl,
    iconSize,
    iconAnchor: [Math.round(iconSize[0] / 2), Math.round(iconSize[1] / 2)],
    popupAnchor: [0, -10],
    className: `map-poi-icon map-poi-icon-${type}`
  });
}

// 全局运行时状态：集中管理地图图层、路线、事故、告警等跨模块数据
const state = {
  cameras: [],
  liveMap: null,
  plannerMap: null,
  // For Habit routes
  habitRoutesMap: null,
  habitRoutesBaseLayer: null,
  habitRoutePolylineLayer: null,
  habitRoutePinLayer: null,
  expresswayLayerGroup: null,
  currentImpactLayer: null,
  habitSavedRoutes: [],
  totalSegmentsScanned: 0,
  majorAnomaliesCaught: 0,
  officialChanges: 0,
  totalSignalVariance: 0,
  historicalPrecision: "66%",
  habitRouteChatContext: {},
  habitRouteJams: {},
  activeRoutePins: [],
  activePopup: null,
  selectedJamPinID: null,
  habitRouteSelectionContext: null,
  currSelectedRoute: null,
  currMatchInfo: null,
  alternateRouteContext: null,
  habitPlanMode: "now",
  habitPlanDatetime: null,
  // -- Hotspots
  mapHotspotsVisible: false,
  mapHotspotsItems: [],
  liveHotspotsLayer: null,

  // -- Journey
  currentRouteIntel: null,
  journeyActive: null,
  incidentMarkerLayer: null,
  // -- End Journey

  // -- admin states
  adminModalOpen: false,
  adminRecordingActive: false,
  adminReplayList: [],
  selectedReplayId: null,
  // -- end admin states
  // End Habit routes
  liveLayer: null,
  liveIncidentLayer: null,
  liveErpLayer: null,
  livePgsLayer: null,
  mapCamerasVisible: true,
  mapErpVisible: false,
  mapPgsVisible: false,
  mapErpItems: [],
  mapPgsItems: [],
  plannerLayer: null,
  routeLayer: null,
  routeFeedbackLayer: null,
  routeConfirmMarkerLayer: null,
  routeConfirmPoiLayer: null,
  routeConfirmProgressLayer: null,
  routeNearestCameraLayer: null,
  routePolylines: new Map(),
  routePlans: [],
  selectedRouteId: null,
  routePreference: "fastest",
  confirmedRouteId: null,
  confirmedRoutePlan: null,
  confirmedRouteOriginalStartGeo: null,
  confirmedRouteEndGeo: null,
  confirmedRouteLastReplanAt: 0,
  confirmedTravelledCoords: [],
  confirmedLastLiveCoord: null,
  routeNearestCameraVisible: false,
  mobileLocationPollId: null,
  routeContext: null,
  routeStartCurrentGeo: null,
  routeLiveMarker: null,
  routeLiveWatchId: null,
  incidentSortMode: "time",
  incidentDataSource: "live",
  incidentMeta: null,
  mapIncidentsVisible: false,
  mapLiveIncidents: [],
  mapAreaAnalysisLayer: null,
  mapAreaAnalysisVisible: false,
  mapIncidentElapsedTimer: null,
  feedbackMapItems: [],
  feedbackMapVisible: false,
  feedbackMapLayer: null,
  routeFeedbackItems: [],
  routeFeedbackLoadedAt: 0,
  adminFeedbackItems: [],
  adminFeedbackFilters: {
    timeRange: "all",
    severity: "all"
  },
  dashboardIncidents: [],
  favoritePlannerPanelVisible: false,
  alertDismissedIds: new Set(),
  selectedAlertIncidentId: null,
  alertAiCache: new Map(),
  userLocation: null,
  alertLocationReady: false,
  alertIncidentById: new Map(),
  alertsInfoFeed: null,

};
