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
const ApiIntegrationControllers = require('../../../controllers/v1/admin/api-integration.controllers');

// Routes
router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_TOKENS
    ),
  ],
  ApiIntegrationControllers.getTokensAndSettings
);

router.patch(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_TOKENS
    ),
  ],
  ApiIntegrationControllers.updateTokensAndSettings
);

module.exports = router;
