// Packages
const express = require('express');
const router = express.Router();

// Route imports
const userRoutes = require('./user/user.routes');

// Routes
router.use('/user', userRoutes);

module.exports = router;
