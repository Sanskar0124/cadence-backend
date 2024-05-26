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
const pipedriveImportController = require('../../../../../controllers/v2/sales/department/cadence-imports/pipedrive-imports.controller');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// * Route to fetch list/lead/contact data from salesforce
router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  pipedriveImportController.importPipedriveDataToCadence
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
  pipedriveImportController.getCSVColumns
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
  pipedriveImportController.getSheetsColumns
);

// * Import persons
router.post(
  '/person',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  pipedriveImportController.importPipedrivePersons
);

// * Import Temp persons
router.post(
  '/temp-persons',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  pipedriveImportController.importPipedriveTempPersons
);

// * Link persons
router.post(
  '/link',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  pipedriveImportController.linkPersonWithCadence
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
  pipedriveImportController.previewLeadsForCSVImport
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
  pipedriveImportController.previewLeadsForSheetsImport
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
  pipedriveImportController.getCustomViews
);

module.exports = router;
