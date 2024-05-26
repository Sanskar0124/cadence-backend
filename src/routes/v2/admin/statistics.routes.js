// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const StatisticsController = require('../../../controllers/v2/admin/statistics.controller');

router.post(
  '/activityfollowup',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.ACTIVITY
    // ),
  ],
  StatisticsController.salesDailyActivityFollowUp
);

router.post(
  '/groupactivityfollowup',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.ACTIVITY
    // ),
  ],
  StatisticsController.salesGroupActivityFollowUp
);

router.post(
  '/useractivity',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.ACTIVITY
    // ),
  ],
  StatisticsController.userActivityStatistics
);

router.post(
  '/groupactivity',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.ACTIVITY
    // ),
  ],
  StatisticsController.groupActivityStatistics
);

router.post(
  '/cadencefollowup',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.ACTIVITY
    // ),
  ],
  StatisticsController.cadenceTaskStatistics
);
router.post(
  '/cadencecontact',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.LEAD
    // ),
  ],
  StatisticsController.cadenceContactStatistics
);
router.post(
  '/cadenceactivity',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.TASK
    // ),
  ],
  StatisticsController.cadenceActivityStatistics
);
router.post(
  '/cadenceactivityforgroup',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.TASK
    // ),
  ],
  StatisticsController.cadenceActivityStatisticsForGroup
);
router.post(
  '/nodeactivity',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.ACTIVITY
    // ),
  ],
  StatisticsController.cadenceNodeStatistics
);
router.post(
  '/disqualifications',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.LEAD
    // ),
  ],
  StatisticsController.disqualificationStatistics
);

router.post(
  '/pending-task-stats',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.TASK
    // ),
  ],
  StatisticsController.pendingTaskStatistics
);

router.post(
  '/completed-task-stats',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.TASK
    // ),
  ],
  StatisticsController.completedTaskStatistics
);
router.post(
  '/history-table-stats',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.TASK
    // ),
  ],
  StatisticsController.historyTableStatistics
);

router.post(
  '/history-graph',
  [
    auth,
    // AccessControlMiddleware.checkAccess(
    //   RBAC_ACTIONS.READ_ANY,
    //   RBAC_RESOURCES.TASK
    // ),
  ],
  StatisticsController.historyGraphStatistics
);

router.post(
  '/heatmap',
  [auth],

  StatisticsController.heatmapStatistics
);

router.get(
  '/fetch-all-users',
  [auth],
  StatisticsController.getAllUsersForStats
);

router.post(
  '/filter-by-cadence',
  [auth],
  StatisticsController.getCadencesByUserid
);

router.get(
  '/fetch-all-cadence',
  [auth],
  StatisticsController.getCadencesForAdmin
);

router.post(
  '/fetch-cadence-nodes',
  [auth],
  StatisticsController.getAllNodesForCadence
);
router.post(
  '/fetch-cadence-users',
  [auth],
  StatisticsController.getUserByCadence
);

module.exports = router;
