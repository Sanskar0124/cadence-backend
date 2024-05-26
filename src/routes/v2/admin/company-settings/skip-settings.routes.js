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
const SkipSettingControllers = require('../../../../controllers/v2/admin/skip-settings.controllers');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  SkipSettingControllers.createSkipSettingException
);

router.patch(
  '/:skip_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  SkipSettingControllers.updateSkipSettingException
);

router.delete(
  '/:skip_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  SkipSettingControllers.deleteSkipSettingException
);

module.exports = router;
