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
const companySettingsController = require('../../../../controllers/v2/admin/company-settings.controllers');

// Routes
const automatedTaskSettingRoutes = require('./automated-task-settings.routes');
const bouncedSettingsRoutes = require('./bounced-mail-settings.routes');
const unsubscribeSettingsRoutes = require('./unsubscribe-mail-settings.routes');
const taskSettingsRoutes = require('./task-settings.routes');
const skipSettingsRoutes = require('./skip-settings.routes');
const leadScoreSettingsRoutes = require('./lead-score-settings.routes');
const companyFieldMapRoutes = require('./company-field-map.routes');
const customDomainSettingsRoutes = require('./custom-domain-settings.routes');
const extensionFieldMapRoutes = require('./extension-field-map.routes');
const webhookRoutes = require('./webhook.routes');

router.use('/automated-task-settings', automatedTaskSettingRoutes);
router.use('/bounced-mail-settings', bouncedSettingsRoutes);
router.use('/unsubscribe-mail-settings', unsubscribeSettingsRoutes);
router.use('/task-settings', taskSettingsRoutes);
router.use('/skip-settings', skipSettingsRoutes);
router.use('/lead-score-settings', leadScoreSettingsRoutes);
router.use('/company-field-map', companyFieldMapRoutes);
router.use('/extension-field-map', extensionFieldMapRoutes);
router.use('/custom-domain-settings', customDomainSettingsRoutes);
router.use('/webhook', webhookRoutes);

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

// * Update user_id in company_settings (user to take salesforce tokens from)
router.patch(
  '/crm-user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updateUserToExtractTokensFrom
);

// * Salesforce user
router.get(
  '/crm-user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.getCrmAdmin
);

router.get(
  '/admins',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.getAdminsAndSuperAdmins
);

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

// * Change emails scope
router.put(
  '/email-scope',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updateCompanyMailScope
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

router.patch(
  '/mail-integration-type',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updateCompanyMailIntegrationType
);

router.patch(
  '/update-instance-url',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updateCompanyInstanceUrl
);

module.exports = router;
