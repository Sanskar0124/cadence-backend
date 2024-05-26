//Packages
const express = require('express');
const router = express.Router();

//Middlewares
const authMiddleware = require('../../../middlewares/auth.middlewares');

//Ruote imports
const oAuthRoutes = require('./authentication/authentication.routes');

//Routes
router.use('/oauth', authMiddleware.auth, oAuthRoutes);

module.exports = router;
