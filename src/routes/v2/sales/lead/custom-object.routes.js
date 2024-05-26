// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const customObjectController = require('../../../../controllers/v2/sales/lead/custom-object.controllers');

// Routes
router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.updateCustomObjectDataForLead
);

router.post(
  '/info',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromSalesforce
);

// * Search sObject
router.get(
  '/search',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchSearchResultsForObject
);

router.get(
  '/pipedrive/person/:person_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromPipedrive
);

router.post(
  '/hubspot/contact/:contact_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromHubspot
);

router.post(
  '/zoho',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromZoho
);

router.post(
  '/bullhorn',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromBullhorn
);

router.post(
  '/sellsy',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromSellsy
);

router.post(
  '/dynamics',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  customObjectController.fetchCustomObjectFromDynamics
);

module.exports = router;
