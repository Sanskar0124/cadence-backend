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
const employeeController = require('../../../../controllers/v1/sales/employee/employee.controllers');

// Route imports
const signatureRoutes = require('./signature.routes');

// Routes
router.get(
  '/dashboard',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SALES_DASHBOARD
    ),
  ],
  employeeController.getDashboardData
);

router.get('/dashboard/fix', employeeController.fixDashboardError);

router.get(
  '/metrics/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  employeeController.getMetrics
);

router.use('/signature', signatureRoutes);

module.exports = router;
