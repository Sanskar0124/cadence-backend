// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const leaderboardControllers = require('../../../controllers/v1/admin/leaderboard.controllers');

// Route imports
const calendarSettingRoutes = require('./calendar-settings.routes');
const emailSettingsRoutes = require('./email-settings.routes');
const dashboardRoutes = require('./dashboard.routes');
const companySettingsRoutes = require('./company-settings.routes');
const companyTokensRoutes = require('./company-tokens.routes');
const apiIntegrationRoutes = require('./api-integration.routes');

// Routes
router.use('/calendar-settings', calendarSettingRoutes);
router.use('/email-settings', emailSettingsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/company-settings', companySettingsRoutes);
router.use('/company-tokens', companyTokensRoutes);
router.use('/api-integration', apiIntegrationRoutes);

router.get(
  '/leaderboard/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_LEADERBOARD
    ),
  ],
  leaderboardControllers.getLeaderboardData
);

router.get(
  '/leaderboard/:user_id/:filter',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.ADMIN_LEADERBOARD
    ),
  ],
  leaderboardControllers.getLeaderboardGraph
);

module.exports = router;
