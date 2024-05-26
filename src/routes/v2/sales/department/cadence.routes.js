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
const cadenceController = require('../../../../controllers/v2/sales/department/cadence.controllers');

// to launch product tour cadence
router.get(
  '/launch/product-tour/:cadence_id',
  [auth],
  cadenceController.launchCadenceForProductTourCadence
);

router.post(
  '/reassign/leads',
  auth,
  cadenceController.reassignLeadsAndContacts
);

router.post('/task-filter', [auth], cadenceController.getCadencesForTaskFilter);
router.get(
  '/move-cadence',
  [auth],
  cadenceController.getCadencesForMoveToCadenceWorflow
);

router.get('/lead-filter', [auth], cadenceController.getCadencesForLeadFilter);

// * Timezone filter
router.get(
  '/timezone-filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getTimezonesForTaskFilter
);

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.createCadence
);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getAllCadences
);

router.get(
  '/imports',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getAllCadencesNameAndId
);

router.get('/test-mail-users', [auth], cadenceController.getTestMailUsers);

router.get(
  '/allowed-statuses',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getAllowedStatuses
);

router.get(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getCadence
);

router.delete(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.deleteManyCadence
);

router.post(
  '/leads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getAllLeadsForCadence
);

router.get(
  '/:cadence_id/stats',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getCadenceLeadsStats
);

router.post(
  '/stop-current',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.stopCurrentCadenceForLead
);

router.post(
  '/duplicate',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.duplicateCadence
);

router.post(
  '/share',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.shareCadence
);

router.get(
  '/check-workflow/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.checkWorkflowInCadence
);

router.get(
  '/statistics/:cadence_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getCadenceStatistics
);

router.post(
  '/statistics-leads/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getCadenceStatisticsLeads
);

router.post(
  '/statistics-mail-leads/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getCadenceMailStatisticsLeads
);

router.post(
  '/statistics-message-leads/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getCadenceMessageStatisticsLeads
);

router.post(
  '/pause',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.bulkPauseCadenceForLead
);

router.post(
  '/stop',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.bulkStopCadenceForLead
);

router.post(
  '/stop-all-cadences',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.bulkStopAllCadencesForLead
);

router.post(
  '/resume',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.bulkResumeCadenceForLead
);

router.put(
  '/:id/favorite',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.toggleFavorite
);

router.get(
  '/:cadence_id/group_info',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CADENCE
    ),
  ],
  cadenceController.getGroupInfoOfGroupCadence
);

module.exports = router;
