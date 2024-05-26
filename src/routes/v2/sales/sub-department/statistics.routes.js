// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const StatisticsController = require('../../../../controllers/v2/sales/sub-department/statistics.controllers');

router.post(
  '/pending-task-stats',
  [auth],
  StatisticsController.pendingTaskStatistics
);

router.post(
  '/completed-task-stats',
  [auth],
  StatisticsController.completedTaskStatistics
);
router.post(
  '/history-table-stats',
  [auth],
  StatisticsController.historyTableStatistics
);

router.post(
  '/history-graph',
  [auth],
  StatisticsController.historyGraphStatistics
);

router.post('/heatmap', [auth], StatisticsController.heatmapStatistics);

module.exports = router;
