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
const zohoImportController = require('../../../../../controllers/v2/sales/department/cadence-imports/zoho-imports.controller');

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
  zohoImportController.getZohoUsers
);

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
  zohoImportController.getCSVColumns
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
  zohoImportController.getSheetsColumns
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
  zohoImportController.previewZohoContactsData
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
  zohoImportController.previewZohoLeadsData
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
  zohoImportController.importZohoContacts
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
  zohoImportController.importZohoLeads
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
  zohoImportController.importZohoTempLeads
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
  zohoImportController.linkContactsWithCadence
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
  zohoImportController.linkLeadsWithCadence
);

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
  zohoImportController.previewLeadsForCSVImport
);

router.post(
  '/sheets/preview-leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  zohoImportController.previewLeadsForSheetsImport
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
  zohoImportController.getZohoCustomViews
);

module.exports = router;
