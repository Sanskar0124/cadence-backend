// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

//importing middlewares
const { auth } = require('../../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../../middlewares/accessControl.middlewares');

// Controllers
const zohoExportController = require('../../../../../controllers/v2/sales/lead/lead-exports/zoho-exports.controllers');

// Routes
router.get(
  '/preview/:lead_id/lead',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  zohoExportController.previewLead
);

router.get(
  '/preview/:lead_id/contact',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  zohoExportController.previewContact
);

router.post(
  '/search-accounts',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  zohoExportController.searchZohoAccounts
);

router.post(
  '/lead',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  zohoExportController.exportLead
);

router.post(
  '/contact',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  zohoExportController.exportContact
);

module.exports = router;
