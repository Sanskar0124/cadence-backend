// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Middlewares
const { auth } = require('../../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../../middlewares/accessControl.middlewares');

// Controllers
const hubspotImportController = require('../../../../../controllers/v2/sales/department/cadence-imports/hubspot-imports.controller');

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
  hubspotImportController.getCSVColumns
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
  hubspotImportController.getSheetsColumns
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
  hubspotImportController.previewHubspotContactsViaCSV
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
  hubspotImportController.importHubspotTempContacts
);

// * Add contacts via CSV
router.post(
  '/csv/add',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.addHubspotContactsViaCSV
);

// * Link contacts via CSV
router.post(
  '/csv/link',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.linkHubspotContactsViaCSV
);

// * Get contacts via webhook
router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.fetchHubspotImportContacts
);

// * Add contacts via webhook
router.post(
  '/add',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.addHubspotContactsViaWebhook
);

// * Link contacts via webhook
router.post(
  '/link',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.linkHubspotContactsViaCSV
);

// * Remove contact from Hubspot imports
router.delete(
  '/:contact_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.deleteContactFromHubspotImports
);

// * Preview leads from csv
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
  hubspotImportController.previewLeadsForCSVImport
);

// * Preview leads from Google sheet
router.post(
  '/sheets/preview-leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.previewLeadsForSheetsImport
);

// * Fetch hubspot contacts from extension
router.get(
  '/extension/preview/:type/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.previewHubspotDataFromExtension
);

router.get(
  '/custom-views',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  hubspotImportController.getCustomViews
);

module.exports = router;
