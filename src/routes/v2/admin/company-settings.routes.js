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
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const companySettingsController = require('../../../controllers/v2/admin/company-settings.controllers');

// Routes
const automatedTaskSettingRoutes = require('./automated-task-settings.routes');
const bouncedSettingsRoutes = require('./bounced-mail-settings.routes');
const unsubscribeSettingsRoutes = require('./unsubscribe-mail-settings.routes');
const skipSettingsRoutes = require('./skip-settings.routes');

router.use('/automated-task-settings', automatedTaskSettingRoutes);
router.use('/bounced-mail-settings', bouncedSettingsRoutes);
router.use('/unsubscribe-mail-settings', unsubscribeSettingsRoutes);
router.use('/skip-settings', skipSettingsRoutes);

router.get(
  '/phone-system',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.getPhoneSystemForAdmin
);

router.patch(
  '/phone-system',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updatePhoneSystemForAdmin
);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.getCompanySettingsForAdmin
);

router.patch(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updateCompanySettingsForAdmin
);

module.exports = router;
