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
const automatedTaskSettingControllers = require('../../../../controllers/v2/sales/sub-department/automated-task-settings.controllers');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  automatedTaskSettingControllers.createAutomatedTaskSettingException
);

router.patch(
  '/:at_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  automatedTaskSettingControllers.updateAutomatedTaskSettingException
);

router.delete(
  '/:at_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  automatedTaskSettingControllers.deleteAutomatedTaskSettingException
);

module.exports = router;
