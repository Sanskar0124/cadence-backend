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
const leadController = require('../../../../controllers/v1/sales/lead/lead.controllers');
const duplicateController = require('../../../../controllers/v1/sales/lead/duplicate.controllers');
const qualificationController = require('../../../../controllers/v1/sales/lead/qualification.controllers');

// Routes imports
const activityRoutes = require('./activity.routes');

// Rotues

// * Unsubscribe from mail list
router.get('/unsubscribe/:id/:node?', leadController.unsubscribeLead);

router.delete(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.moveLeadToTrash
);

router.delete(
  '/permanent/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.deleteLeadWithPhoneNumber
);

router.post(
  '/restore/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.restoreFromTrash
);

//Duplicate routes
router.get(
  '/duplicate/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  duplicateController.getDuplicatesForLead
);

router.post(
  '/merge/duplicate',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  duplicateController.mergeDuplicateLeads
);

router.post(
  '/duplicate/remove',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  duplicateController.updateDuplicateLeadStatus
);

router.use('/activity', activityRoutes);

// Salesforce Lead routes
router.get(
  '/salesforce/lead/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getSalesforceLeadInfo
);
router.put(
  '/qual/lead/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  qualificationController.updateLeadQualification
);

// Salesforce account routes
router.get(
  '/salesforce/account/:id',
  auth,
  leadController.getSalesforceAccountInfo
);

router.put(
  '/qual/account/:id',
  auth,
  qualificationController.updateAccountQualification
);

module.exports = router;
