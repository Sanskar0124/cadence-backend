// * Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const express = require('express');
const router = express();

// * Middlewares
const { supportAuth } = require('../../../middlewares/support.middlewares');

// * Controllers
const supportController = require('../../../controllers/v2/support/cadence-template.controller');

// * Create cadence template
router.post('/', supportAuth, supportController.createCadenceTemplate);

// * Fetch cadence templates
router.get('/', supportAuth, supportController.fetchAllCadenceTemplates);

// * Update cadence template
router.put('/:id', supportAuth, supportController.updateCadenceTemplate);

// * Delete cadence template
router.delete('/:id', supportAuth, supportController.deleteCadenceTemplate);

module.exports = router;
