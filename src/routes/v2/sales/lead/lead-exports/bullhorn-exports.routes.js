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
const bullhornExportController = require('../../../../../controllers/v2/sales/lead/lead-exports/bullhorn-exports.controllers');

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
  bullhornExportController.previewLead
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
  bullhornExportController.previewContact
);

router.get(
  '/preview/:lead_id/candidate',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  bullhornExportController.previewCandidate
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
  bullhornExportController.searchBullhornAccounts
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
  bullhornExportController.exportLead
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
  bullhornExportController.exportContact
);

router.post(
  '/candidate',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  bullhornExportController.exportCandidate
);

module.exports = router;
