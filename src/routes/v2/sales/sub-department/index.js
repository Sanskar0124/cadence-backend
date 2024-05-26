// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const formidableMiddleware = require('express-formidable');
const router = express.Router();
const multer = require('multer');
const os = require('os');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const subDepartmentController = require('../../../../controllers/v2/sales/sub-department/sub-department.controllers');

// Route imports
const subDepartmentSettingsRoutes = require('./sub-department-settings.routes');
const managerRoutes = require('./manager.routes');
const statisticsRoute = require('./statistics.routes');

router.use('/settings', subDepartmentSettingsRoutes);
router.use('/manager', managerRoutes);
router.use('/statistics', statisticsRoute);

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
    formidableMiddleware(),
  ],
  subDepartmentController.createSubDepartment
);

router.patch(
  '/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.updateSubDepartment
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
  subDepartmentController.fetchAllSubDepartmentsForCompany
);

router.get(
  '/with-users',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.fetchAllSubDepartmentsForCompanyWithUsersAndAdmins
);

router.delete(
  '/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.deleteSubDepartment
);

router.post(
  '/users',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
    upload.single('file'),
  ],
  subDepartmentController.addUsersToSubDepartmentViaCSV
);

router.post(
  '/user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT
    ),
  ],
  subDepartmentController.addUserToSubDepartment
);

router.post(
  '/user/invite',
  auth,
  subDepartmentController.sendJoinRequestToUsers
);

router.get('/user/join', subDepartmentController.isPageAllowed);

// router.post('/user/setup', subDepartmentController.setupPassword);

router.get(
  '/employees',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_EMPLOYEES
    ),
  ],
  subDepartmentController.getAllEmployeesForManager
);

router.get(
  '/employees/admin/admins',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_EMPLOYEES
    ),
  ],
  subDepartmentController.getAllAdminsForAdmin
);

router.get(
  '/employees/admin/:sd_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_EMPLOYEES
    ),
  ],
  subDepartmentController.getAllEmployeesForAdmin
);

router.post(
  '/team-change',
  [auth],
  subDepartmentController.changeSubDepartmentForUser
);

router.get(
  '/user-info/:user_id',
  [auth],
  subDepartmentController.getTeamUserInfo
);

// * Fetch users from Ringover
router.get(
  '/ringover-users',
  [auth],
  subDepartmentController.getUsersFromRingover
);

module.exports = router;
