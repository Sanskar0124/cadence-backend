// Packages
const express = require('express');
const router = express.Router();

// Middlewares
//const { auth } = require('../../../../middlewares/auth.middlewares');
const {
  externalAuth,
} = require('../../../../middlewares/external.middlewares');

// Controllers
const leadCreationController = require('../../../../controllers/v1/sales/salesforce-integrations/lead.controllers');

router.post('/', externalAuth, leadCreationController.createLeads);
router.get(
  '/:id',
  externalAuth,
  leadCreationController.getLeadsBySalesforceLeadId
);
router.put('/', externalAuth, leadCreationController.updateLeads);
router.delete('/', externalAuth, leadCreationController.deleteLeads);

router.post('/link', externalAuth, leadCreationController.linkLeadsWithCadence);
router.put(
  '/status',
  externalAuth,
  leadCreationController.updateLeadToCadenceStatus
);
router.put(
  '/owner-update',
  externalAuth,
  leadCreationController.updateLeadOwnerId
);

// * Check if lead is present in cadence
router.get(
  '/cadence/:integration_id',
  externalAuth,
  leadCreationController.checkIfExists
);

module.exports = router;
