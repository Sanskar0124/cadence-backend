// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const ExtensionFieldMapControllers = require('../../../../controllers/v2/admin/extension-field-map.controllers');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  ExtensionFieldMapControllers.createExtensionFieldMap
);

// * Fetch salesforce map
router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  ExtensionFieldMapControllers.fetchExtensionFieldMap
);

// * Set all salesforce field maps
router.post(
  '/all',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  ExtensionFieldMapControllers.updateAllExtensionFieldMap
);

// * Set all salesforce field maps
router.get(
  '/auto-map',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  ExtensionFieldMapControllers.autoMapExtensionFieldMap
);

module.exports = router;
