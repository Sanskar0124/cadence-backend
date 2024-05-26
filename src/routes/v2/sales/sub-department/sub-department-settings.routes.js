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
const SubDepartmentSettingsController = require('../../../../controllers/v2/sales/sub-department/sub-department-settings.controllers');

// Routes
const automatedTaskSettingRoutes = require('./automated-task-settings.routes');
const bouncedSettingsRoutes = require('./bounced-mail-settngs.routes');
const unsubscribeSettingsRoutes = require('./unsubscribe-mail-setings.routes');
const taskSettingsRoutes = require('./task-settings.routes');
const skipSettingsRoutes = require('./skip-settings.routes');
const leadScoreSettingsRoutes = require('./lead-score-settings.routes');

router.use('/automated-task-settings', automatedTaskSettingRoutes);
router.use('/bounced-mail-settings', bouncedSettingsRoutes);
router.use('/unsubscribe-mail-settings', unsubscribeSettingsRoutes);
router.use('/task-settings', taskSettingsRoutes);
router.use('/skip-settings', skipSettingsRoutes);
router.use('/lead-score-settings', leadScoreSettingsRoutes);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.getSubDepartmentSettings
);

router.patch(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.updateSubDepartmentSettings
);

module.exports = router;
