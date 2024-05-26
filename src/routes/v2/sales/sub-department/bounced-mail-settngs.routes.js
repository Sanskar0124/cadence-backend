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
const BouncedMailSettingControllers = require('../../../../controllers/v2/sales/sub-department/bounced-mail-settings.controllers');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  BouncedMailSettingControllers.createBouncedMailSettingException
);

router.patch(
  '/:bounced_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  BouncedMailSettingControllers.updateBouncedMailSettingException
);

router.delete(
  '/:bounced_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  BouncedMailSettingControllers.deleteBouncedMailSettingException
);

module.exports = router;
