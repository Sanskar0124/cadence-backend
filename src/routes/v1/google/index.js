// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const authMiddleware = require('../../../middlewares/auth.middlewares');

// Route imports
const oAuthRoutes = require('./authentication/authentication.routes');
const sheetsRoutes = require('./sheets/sheets.routes');

// Routes
router.use('/oauth', authMiddleware.auth, oAuthRoutes);
router.use('/sheets', sheetsRoutes);

module.exports = router;
