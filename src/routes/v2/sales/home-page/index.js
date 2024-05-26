// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const homepageController = require('../../../../controllers/v2/sales/home-page/homepage.controllers.js');

// Routes

router.post(
  '/live-feed',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ACTIVITY
    ),
  ],
  homepageController.fetchLiveFeed
);

router.get(
  '/pending-tasks',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ACTIVITY
    ),
  ],
  homepageController.fetchPendingTasks
);
router.get(
  '/pending-task-cadences',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ACTIVITY
    ),
  ],
  homepageController.fetchPendingTaskCadences
);

router.get(
  '/active-cadences',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  homepageController.fetchActiveCadences
);

router.get(
  '/progress',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  homepageController.fetchTaskCompletion
);

module.exports = router;
