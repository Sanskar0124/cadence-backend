// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const {
  externalAuth,
} = require('../../../../middlewares/external.middlewares');

// Controllers
const opportunityControllers = require('../../../../controllers/v1/sales/salesforce-integrations/opportunity.controllers');

// router.get('/:id', externalAuth, accountController.getAccount);
router.put('/', opportunityControllers.updateOpportunity);
router.delete('/', externalAuth, opportunityControllers.deleteOpportunities);

module.exports = router;
