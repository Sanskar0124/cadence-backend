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
const LeadScoreSettingControllers = require('../../../../controllers/v2/admin/lead-score-settings.controllers');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  LeadScoreSettingControllers.createLeadScoreSettingsException
);

router.patch(
  '/:ls_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  LeadScoreSettingControllers.updateLeadScoreSettingsException
);

router.delete(
  '/:ls_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  LeadScoreSettingControllers.deleteLeadScoreSettingsexception
);

module.exports = router;
