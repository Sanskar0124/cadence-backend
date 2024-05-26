// Package imports
const express = require('express');
const app = express();

// Route imports
const userRoutes = require('./user');
const adminRoutes = require('./admin');
const salesforceRoutes = require('./salesforce');
const googleRoutes = require('./google');
const ringoverRoutes = require('./ringover');
const trackingRoutes = require('./tracking');
const salesRoutes = require('./sales');

// Routes
app.use('/user', userRoutes);
app.use('/admin', adminRoutes);
app.use('/salesforce', salesforceRoutes);
app.use('/google', googleRoutes);
app.use('/ringover', ringoverRoutes);
app.use('/link_store', trackingRoutes);
app.use('/sales', salesRoutes);

module.exports = app;
