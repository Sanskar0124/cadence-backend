// * Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const express = require('express');
const router = express();

// * Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');

// * Routes
const cadenceTemplateRoutes = require('./cadence-template.routes');
const userRoutes = require('./user.routes');

router.use('/cadence-template', cadenceTemplateRoutes);
router.use('/user', userRoutes);

module.exports = router;
