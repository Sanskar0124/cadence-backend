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
const UnsubscribeMailSettingControllers = require('../../../../controllers/v2/admin/unsubscribe-mail-settings.controllers');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  UnsubscribeMailSettingControllers.createUnsubscribeMailSettingException
);

router.patch(
  '/:unsubscribe_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  UnsubscribeMailSettingControllers.updateUnsubscribeMailSettingException
);

router.delete(
  '/:unsubscribe_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  UnsubscribeMailSettingControllers.deleteUnsubscribeMailSettingException
);

module.exports = router;
