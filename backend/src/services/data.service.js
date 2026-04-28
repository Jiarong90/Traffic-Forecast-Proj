const { withCache } = require('./cache.service');
const { deriveIncidentArea, toNumber } = require('../utils/common');
const dataSource = require('./dataSource.service');
const onemotoring = require('./onemotoring.service');
const rss = require('./rss.service');
const trafficCameras = require('./trafficCameras.service');
const trafficIncidents = require('./trafficIncidents.service');
const roadNetwork = require('./roadNetwork.service');

module.exports = {
  withCache,
  ...dataSource,
  ...onemotoring,
  ...rss,
  ...trafficCameras,
  ...trafficIncidents,
  ...roadNetwork,
  deriveIncidentArea,
  toNumber
};
