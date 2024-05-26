// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const multer = require('multer');
const router = express.Router();
const os = require('os');

// Middlewares
const { auth } = require('../../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../../middlewares/accessControl.middlewares');

// Controllers
const bullhornImportController = require('../../../../../controllers/v2/sales/department/cadence-imports/bullhorn-imports.controllers');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// * Route to fetch all user from zoho in cadence
router.get(
  '/user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.getBullhornUsers
);

// * Import filtered contacts data
router.post(
  '/contacts',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornContactsData
);

// * Import filtered candidates data
router.post(
  '/candidates',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornCandidatesData
);

// * Import filtered Leads data
router.post(
  '/leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornLeadsData
);
router.post(
  '/contacts/import',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornContacts
);

// * Import Leads data
router.post(
  '/leads/import',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornLeads
);

router.post(
  '/candidates/import',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornCandidates
);

// * Import Temp leads
router.post(
  '/temp-leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.importBullhornTempLeads
);

// * Link leads
router.post(
  '/link/contacts',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.linkContactsWithCadence
);

// * Link leads
router.post(
  '/link/leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.linkLeadsWithCadence
);

router.post(
  '/link/candidates',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.linkCandidatesWithCadence
);

router.post(
  '/preview-contacts',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  bullhornImportController.previewContactsForCSVImport
);

router.post(
  '/extract-columns',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  bullhornImportController.getCSVColumns
);

// * Fetch Google Sheets Columns
router.post(
  '/sheets/extract-columns',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.getSheetsColumns
);

router.post(
  '/preview-leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  bullhornImportController.previewLeadsForCSVImport
);

router.post(
  '/preview-candidates',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  bullhornImportController.previewCandidatesForCSVImport
);

router.get(
  '/extension/preview',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.previewBullhornDataFromExtension
);

// * Preview leads from csv for csv import
router.post(
  '/csv/preview-leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  bullhornImportController.previewLeadsViaCSV
);

// * Preview leads from Google sheet for csv import
router.post(
  '/sheets/preview-leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.previewLeadsViaSheets
);

router.get(
  '/saved-search',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  bullhornImportController.getSavedSearch
);

module.exports = router;
