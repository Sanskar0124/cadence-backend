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
const EnrichmentControllers = require('../../../controllers/v2/admin/enrichments.controllers');

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ENRICHMENTS
    ),
  ],
  EnrichmentControllers.getEnrichments
);

router.get(
  '/config',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ENRICHMENTS
    ),
  ],
  EnrichmentControllers.getConfigurations
);

router.put(
  '/config',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.ENRICHMENTS
    ),
  ],
  EnrichmentControllers.updateConfigurations
);

router.get(
  '/sub-departments',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_EMPLOYEES
    ),
  ],
  EnrichmentControllers.getAllSubdepartmentsWithUsers
);

router.put(
  '/access',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  EnrichmentControllers.updateEnrichmentsAccess
);

module.exports = router;
