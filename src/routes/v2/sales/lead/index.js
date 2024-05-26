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
const leadController = require('../../../../controllers/v2/sales/lead/lead.controllers');

// Route imports
const emailRoutes = require('./email.routes');
const replyRoutes = require('./reply.routes');
const customObjectRoutes = require('./custom-object.routes');
const noteRoutes = require('./note.routes');
const customVariableRoutes = require('./custom-variable.routes');
const opportunityRoutes = require('./opportunity.routes');
const csvDataRoutes = require('./csv-data.routes');
const leadExportRoutes = require('./lead-exports');

// Routes
router.use('/email', emailRoutes);
router.use('/reply', replyRoutes);
router.use('/custom-object', customObjectRoutes);
router.use('/note', noteRoutes);
router.use('/custom-variable', customVariableRoutes);
router.use('/opportunity', opportunityRoutes);
router.use('/csv-data', csvDataRoutes);
router.use('/export', leadExportRoutes);

router.get(
  '/dropdown',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.fetchLeadsForDropdown
);

router.get(
  '/count/:user_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadsCountForUser
);

router.post(
  '/getRelatedLeads',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getRelatedLeads
);

router.get(
  '/addresses',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadAddresses
);

router.get(
  '/field-map',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadFieldMap
);

router.get(
  '/info/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadInfo
);

router.get(
  '/activities/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadActivities
);

router.get(
  '/cadence-list/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadCadences
);

router.post(
  '/update',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.updateLeadAndAccountDetailsNew
);

router.post(
  '/update/new',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.updateLeadAndAccountDetailsNew
);

router.post(
  '/list',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadsListViewForUser
);

router.get(
  '/cadences/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadToCadenceLinksForLead
);

router.post(
  '/:lead_id/enrich/lusha',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.enrichLeadWithLusha
);

router.post(
  '/:lead_id/enrich/kaspr',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.enrichLeadWithKaspr
);

router.post(
  '/:lead_id/enrich/hunter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.enrichLeadWithHunter
);

router.post(
  '/:lead_id/enrich/dropcontact',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.enrichLeadWithDropcontact
);

router.post(
  '/:lead_id/enrich/snov',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.enrichLeadWithSnov
);

router.get(
  '/crm-data/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadInfoFromCRM
);

router.get(
  '/duplicate/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadDuplicates
);

// * Integration status update
router.put(
  '/status/lead/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.updateLeadIntegrationStatus
);

router.put(
  '/status/account/:account_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.updateAccountIntegrationStatus
);

router.put(
  '/reset-lead-score/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.removeHotLeadStatus
);

router.get(
  '/lead-score-reasons/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadScoreReasonsForLead
);

router.get(
  '/lead-score/:lead_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadScore
);

// * Disqualify lead
router.post(
  '/disqualify',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.disqualifyLead
);

// * Convert lead
router.post(
  '/convert',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.convertLead
);

router.post('/reassign', auth, leadController.reassign);
router.post(
  '/whatsapp-message',
  auth,
  leadController.sendWhatsappMessageToLead
);

router.delete('/delete', auth, leadController.deleteLeads);

// * Execute webhook
router.post(
  '/execute-webhook',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.executeWebhook
);

//get resume
router.post(
  '/lead-resume',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.getLeadResume
);

//parse resume
router.post(
  '/parse-resume',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.LEAD
    ),
  ],
  leadController.parseResume
);
module.exports = router;
