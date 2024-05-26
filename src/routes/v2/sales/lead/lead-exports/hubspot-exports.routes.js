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
const hubspotExportController = require('../../../../../controllers/v2/sales/lead/lead-exports/hubspot-exports.controllers');

// Routes
router.get(
  '/preview/:lead_id/contact',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  hubspotExportController.previewContact
);

router.post(
  '/search-companies',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  hubspotExportController.searchHubspotCompanies
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
  hubspotExportController.exportContact
);

module.exports = router;
