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
const sellsyImportController = require('../../../../../controllers/v2/sales/department/cadence-imports/sellsy-imports.controller');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// * Fetch CSV Columns
router.post(
  '/csv/extract-columns',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  sellsyImportController.getCSVColumns
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
  sellsyImportController.getSheetsColumns
);

// * Import contacts
router.post(
  '/csv/contacts',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    upload.single('file'),
  ],
  sellsyImportController.previewContactsForCSVImport
);

// contact list routes
router.post(
  '/contact-list',
  [auth],
  sellsyImportController.fetchSellsyContactList
);

router.post(
  '/contact/add',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  sellsyImportController.importSellsyContacts
);

// * Link contacts via CSV
router.post(
  '/link',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  sellsyImportController.linkContactWithCadence
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
  sellsyImportController.previewLeadsViaCSV
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
  sellsyImportController.previewLeadsViaSheets
);

// * Import Temp contacts
router.post(
  '/temp-contacts',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  sellsyImportController.importSellsyTempContacts
);

module.exports = router;
