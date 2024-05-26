// * Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const express = require('express');
const router = express.Router();

// * Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');

// * Controllers
const cadenceTemplateController = require('../../../../controllers/v2/sales/department/cadence-template.controller');

// * Fetch cadence template
router.get('/', auth, cadenceTemplateController.fetchCadenceTemplates);

// * Use cadence template
router.post(
  '/use-template',
  auth,
  cadenceTemplateController.useCadenceTemplate
);

module.exports = router;
