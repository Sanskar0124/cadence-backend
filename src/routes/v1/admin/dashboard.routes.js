// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const dashboardController = require('../../../controllers/v1/admin/dashboard.controllers');

// Routes

router.get(
  '/users/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.USER
    ),
  ],
  dashboardController.getSubDepartmentUsers
);
router.get(
  '/monitoring/sub-department/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getMonitoringForSubDepartment
);
router.get(
  '/monitoring/sub-department/:status/:user_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.ACTIVITY
    ),
  ],
  dashboardController.getLeadsActivtiesForMonitoring
);
router.get(
  '/metrics/sub-department/:sd_id/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getMetricsForSubDepartment
);
router.get(
  '/monitoring/:department_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getMonitoringForDashboard
);

router.get(
  '/metrics/:department_id/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getMetricsForDashboard
);

router.get(
  '/subdepartments',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getAllSubdepartments
);

router.get(
  '/get_all_users_of_subdepartment_with_tasks/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getAllUsersOfSubdepartmentWithTaskCount
);

router.get(
  '/get_tasks_of_user/:user_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_DASHBOARD
    ),
  ],
  dashboardController.getTasksOfUser
);

module.exports = router;
