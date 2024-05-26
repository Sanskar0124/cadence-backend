// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const CompanyFieldMap = require('../../../../controllers/v2/admin/company-field-map.controllers');

// * Fetch company map
router.get('/', [auth], CompanyFieldMap.fetchCompanyFieldMap);

module.exports = router;
