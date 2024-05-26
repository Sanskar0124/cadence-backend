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
const companySettingsController = require('../../../controllers/v1/admin/company-settings.controller.js');

// Routes

// * Fetch company settings
router.get(
  '/:company_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.getCompanySettings
);

// * Update company settings
router.put(
  '/:company_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  companySettingsController.updateCompanySettings
);

module.exports = router;
