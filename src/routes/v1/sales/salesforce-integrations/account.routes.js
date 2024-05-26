// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const {
  externalAuth,
} = require('../../../../middlewares/external.middlewares');

// Controllers
const accountController = require('../../../../controllers/v1/sales/salesforce-integrations/account.controllers');

router.get('/:id', externalAuth, accountController.getAccount);
router.put('/', externalAuth, accountController.updateAccounts);
router.put(
  '/owner-update',
  externalAuth,
  accountController.updateAccountOwnerId
);
router.delete('/', externalAuth, accountController.deleteAccount);

module.exports = router;
