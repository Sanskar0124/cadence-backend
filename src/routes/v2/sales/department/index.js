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

// Controller
const departmentController = require('../../../../controllers/v2/sales/department/department.controllers');

// Route imports
const taskRoutes = require('./task.routes');
const cadenceImportRoutes = require('./cadence-imports');
const cadenceRoutes = require('./cadence.routes');
const cadenceTemplateRoutes = require('./cadence-template.routes');
const templateRoutes = require('./template.routes');
const nodeRoutes = require('./node.routes');
const SalesforceFieldMapRoutes = require('./salesforce-field-map.routes');
const VideoRoutes = require('./video.routes');

// Routes
router.use('/task', taskRoutes);
router.use('/cadence/import', cadenceImportRoutes);
router.use('/cadence', cadenceRoutes);
router.use('/cadence-template', cadenceTemplateRoutes);
router.use('/templates', templateRoutes);
router.use('/node', nodeRoutes);
router.use('/salesforce-field-map', SalesforceFieldMapRoutes);
router.use('/video', VideoRoutes);

router.get(
  '/employees',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.DEPARTMENT_EMPLOYEES
    ),
  ],
  departmentController.getAllEmployees
);

// * Search employees
router.get(
  '/employees/search',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.DEPARTMENT_EMPLOYEES
    ),
  ],
  departmentController.searchUsers
);

// * Fetch all company users
router.get(
  '/company/employees',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.DEPARTMENT_EMPLOYEES
    ),
  ],
  departmentController.getAllCompanyUsers
);

router.get('/templatefilter/employees', [
  auth,
  AccessControlMiddleware.checkAccess(
    RBAC_ACTIONS.READ_OWN,
    RBAC_RESOURCES.DEPARTMENT_EMPLOYEES
  ),
  departmentController.getEmployeesForTemplateFilters,
]);

module.exports = router;
