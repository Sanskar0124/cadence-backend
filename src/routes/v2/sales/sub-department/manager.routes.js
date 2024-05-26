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
const managerController = require('../../../../controllers/v2/sales/sub-department/manager.controllers');

router.post(
  '/tasks/user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_TASKS_VIEW
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.TASK
    ),
  ],
  managerController.getTasksForAnySdUser
);

router.get(
  '/tasks/user/count/summary/:user_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_TASKS_VIEW
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.TASK
    ),
  ],
  managerController.getCountSummaryForTasksViewForAnySdUser
);

module.exports = router;
