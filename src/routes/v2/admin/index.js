// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const { devAuth } = require('../../../middlewares/dev.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const adminController = require('../../../controllers/v2/admin/admin.controllers');

// Route imports
const companySettingsRoutes = require('./company-settings');
const statisticsRoutes = require('./statistics.routes');
const statisticsRedesignRoutes = require('./statisticsRedesign.routes');
const workflowRoutes = require('./workflow.routes');
const enrichmentRoutes = require('./enrichments.routes');
const automatedWorkflowRoutes = require('./automated-workflows.routes');

router.use('/company-settings', companySettingsRoutes);
router.use('/statistics', statisticsRoutes);
router.use('/statistics2', statisticsRedesignRoutes);
router.use('/workflow', workflowRoutes);
router.use('/enrichments', enrichmentRoutes);
router.use('/automated-workflow', automatedWorkflowRoutes);

router.put('/user', [
  auth,
  AccessControlMiddleware.checkAccess(
    RBAC_ACTIONS.UPDATE_OWN,
    RBAC_RESOURCES.USER
  ),
  adminController.updateSdUser,
]);

router.post(
  '/tasks/user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_TASKS_VIEW
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.TASK
    ),
  ],
  adminController.getTasksForAnyCompanyUser
);

router.get(
  '/tasks/user/count/summary/:user_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_TASKS_VIEW
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.TASK
    ),
  ],
  adminController.getCountSummaryForTasksViewForAnyCompanyUser
);

router.get(
  '/cadences',
  [
    auth,
    //AccessControlMiddleware.checkAccess(
    //RBAC_ACTIONS.READ_OWN,
    //RBAC_RESOURCES.ADMIN_CADENCES_VIEW
    //),
  ],
  adminController.getAllCadences
);

router.get(
  '/fetch-api-token',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.API_TOKEN
    ),
  ],
  adminController.fetchApiToken
);
router.get(
  '/generate-token',
  [
    auth,

    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.API_TOKEN
    ),
  ],
  adminController.generateApiToken
);
router.post('/logout-user', auth, adminController.logoutUser);
router.get('/logout-all-user', devAuth, adminController.logoutAllUsers);
router.get(
  '/payment-data',
  [
    auth,

    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.PAYMENT_DATA
    ),
  ],
  adminController.paymentData
);

module.exports = router;
