// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Pacakages
const express = require('express');
const router = express();

// Middlwares
const { auth } = require('../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const extensionControllers = require('../../../controllers/v2/extension/extension.controllers');

router.post(
  '/leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  extensionControllers.createLeads
);

router.post(
  '/cadences/leads/add',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  extensionControllers.addLeadToCadence
);

router.patch(
  '/version',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  extensionControllers.updateExtensionVersion
);

module.exports = router;
