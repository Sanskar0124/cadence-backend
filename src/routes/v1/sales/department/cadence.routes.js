// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();
const multer = require('multer');
var storage = multer.memoryStorage();
const upload = multer({ storage });

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const cadenceController = require('../../../../controllers/v1/sales/department/cadence.controllers');
const CompanySettingsController = require('../../../../controllers/v1/admin/company-settings.controller');
const CadenceController = require('../../../../controllers/v1/sales/department/cadence.controllers');

// Routes

// * Route to fetch company settings for automated and sem-automated mail
router.get(
  '/company-settings',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  CompanySettingsController.getCompanySettingsForUser
);

router.put(
  '/status',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  CadenceController.changeStatusForLeadInCadence
);

router.put(
  '/pause',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  CadenceController.pauseCadenceForTime
);

router.put(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.updateCadence
);

// * Update cadence name
router.put(
  '/name/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.updateCadenceName
);

router.delete(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.deleteCadence
);

router.post(
  '/lead/pause',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  cadenceController.pauseCadenceForLead
);

router.post(
  '/lead/resume',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  cadenceController.resumeCadenceForLead
);

router.post(
  '/lead/stop',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  cadenceController.stopCadenceForLead
);
router.get(
  '/lead/sidebar/:lead_id/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  cadenceController.getCadenceSidebarForLead
);

// * Stop cadence for lead and reassign to other cadence
router.post(
  '/reassign',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  cadenceController.stopCadenceForLeadAndReplaceCadence
);

router.get(
  '/launch/:cadence_id',
  [
    auth,
    //AccessControlMiddleware.checkAccess(
    //RBAC_ACTIONS.UPDATE_OWN,
    //RBAC_RESOURCES.CADENCE
    //),
    //AccessControlMiddleware.checkAccess(
    //RBAC_ACTIONS.READ_OWN,
    //RBAC_RESOURCES.LEAD
    //),
  ],
  CadenceController.launchCadence
);

router.get(
  '/statistics/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.getCadenceStatistics
);

// *  Fetch accounts from cadence_id
router.get(
  '/accounts/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.getAllAccountsForCadence
);

// * Change account owner
router.put(
  '/account/change-owner',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.changeAccountOwner
);

// * Change lead owner
router.put(
  '/lead/change-owner',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.changeLeadOwner
);

// * Reassign all accounts of salesperson
router.put(
  '/account/reassign-owners',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.reassignAllAccountsOfSalesperson
);

// * Reassign all leads of salesperson
router.put(
  '/lead/reassign-owners',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.reassignAllLeadsOfSalesperson
);

// * Reassign all contacts of salesperson
router.put(
  '/contact/reassign-owners',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.reassignAllContactsOfSalesperson
);

// *  Fetch account lead breakdown
router.get(
  '/user/account-lead-breakdown/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.LEAD
    ),
  ],
  CadenceController.getUserAccountLeadBreakdown
);
router.get(
  '/statistics/mail/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  CadenceController.getStatistics
);

router.get(
  '/statistics/mail/:cadence_id/:node_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  CadenceController.getStatisticsByNode
);

module.exports = router;
