// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const formidableMiddleware = require('express-formidable');
const router = express.Router();

// Middelewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const {
  automationAuth,
} = require('../../../../middlewares/automation.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const managerController = require('../../../../controllers/v1/sales/sub-department/manager.controllers');
const subDepartmentController = require('../../../../controllers/v1/sales/sub-department/sub-department.controllers');
const leaderboardControllers = require('../../../../controllers/v1/sales/sub-department/leaderboard.controllers');

// Route imports
const SubDepartmentSettingsRoutes = require('./sub-department-settings.routes');

// Routes
router.use('/settings', SubDepartmentSettingsRoutes);

router.post(
  '/delete',
  // [
  //   auth,
  // ],
  subDepartmentController.deleteSubDepartment
);

router.get(
  '/employees_with_task_count', // taskCount only (last 24 hours)
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  subDepartmentController.fetchSubDepartmentUsersWithCompletedTasksCount
);

router.get(
  '/user-tasks/:user_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  subDepartmentController.fetchTasksOfAnyUser
);

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.createSubDepartment
);

router.post(
  '/changeProfilePicture',
  formidableMiddleware(),
  subDepartmentController.changeProfilePicture
);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.fetchAllSubDepartments
);
router.get(
  '/dashboard',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_DASHBOARD
    ),
  ],
  managerController.getDashboardData
);

router.get(
  '/dashboard/monitoring/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_DASHBOARD
    ),
  ],
  managerController.getMonitoringForManager
);
router.get(
  '/dashboard/monitoring/:status/:user_id',
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
  managerController.getLeadsActivtiesForMonitoring
);
router.get(
  '/dashboard/metrics/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_DASHBOARD
    ),
  ],
  managerController.getMetricsForManager
);

router.get(
  '/employees',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  subDepartmentController.fetchAllSubDepartmentEmployeesByManager
);
router.get(
  '/employees/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  subDepartmentController.fetchAllSubDepartmentEmployeesByAdmin
);

router.get(
  '/leaderboard/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_LEADERBOARD
    ),
  ],
  leaderboardControllers.getLeaderboardData
);

router.get(
  '/leaderboard/:user_id/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.MANAGER_LEADERBOARD
    ),
  ],
  leaderboardControllers.getLeaderboardGraph
);

// Get sub department information
router.get(
  '/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.fetchSubDepartment
);
router.put(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.updateSubDepartment
);

module.exports = router;
