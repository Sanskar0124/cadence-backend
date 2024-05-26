// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const StatisticsRedesignController = require('../../../controllers/v2/admin/statisticsRedesign.controllers');

router.post(
  '/cadence-status',
  [auth],
  StatisticsRedesignController.cadenceStatisticsController
);

// router.post(
//   '/task-status',
//   [auth],
//   StatisticsRedesignController.taskStatisticsController
// );

router.post(
  '/lead-status',
  [auth],
  StatisticsRedesignController.leadStatusCountController
);

router.post(
  '/opportunity',
  [auth],
  StatisticsRedesignController.opportunityMetrics
);

router.post(
  '/revenue-graph',
  [auth],
  StatisticsRedesignController.revenueMetricsController
);

router.post(
  '/pending-tasks',
  [auth],
  StatisticsRedesignController.pendingTaskStatistics
);

router.post(
  '/completed-tasks',
  [auth],
  StatisticsRedesignController.completedTaskStatistics
);

router.post(
  '/skipped-tasks',
  [auth],
  StatisticsRedesignController.skippedTaskStatistics
);

router.post(
  '/history-graph',
  [auth],
  StatisticsRedesignController.historyGraphStatistics
);

router.post('/heatmap', [auth], StatisticsRedesignController.heatmapStatistics);

router.post(
  '/table',
  [auth],
  StatisticsRedesignController.historyTableStatistics
);

router.post(
  '/update-table-columns',
  [auth],
  StatisticsRedesignController.historyTableUpdate
);
router.get(
  '/table-columns',
  [auth],
  StatisticsRedesignController.getHistoryTableColumns
);

router.post(
  '/compare-cadence',
  [auth],
  StatisticsRedesignController.cadenceComparisonController
);

module.exports = router;
