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
const taskController = require('../../../../controllers/v2/sales/department/task.controllers');

// Routes

// to complete task for product tour dummy lead
router.post(
  '/complete/dummy-lead',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.markAsCompleteForDummyLeads
);

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.getTasks
);

router.get(
  '/count/summary',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ACTIVITY
    ),
  ],
  taskController.getCountSummaryForTasksView
);

// * Skip any task
router.post(
  '/skip-task/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.skipTask
);
router.get(
  '/skip-task-reasons/:task_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.getSkipTaskReasons
);

router.post(
  '/complete/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.markAsComplete
);

router.post(
  '/custom',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.createCustomTask
);

router.patch(
  '/custom/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.updateCustomTask
);

router.post(
  '/update/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.updateStartTime
);
router.get(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.getTaskById
);

router.get(
  '/custom/:task_id/:event_id?',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.TASK
    ),
  ],
  taskController.getCustomTask
);

module.exports = router;
